BOA_FLOORPLAN_CSV = "\n".join(
    [
        "transaction_date,post_date,amount,reference_number,description,account,stock_number,vin",
        (
            '2026-04-28,2026-04-28,"$25,000.00",551240,'
            "BOA floorplan advance 551240/M20500 VIN 1FTFW1E80PFA11111,"
            "Floorplan Payable,M20500,1FTFW1E80PFA11111"
        ),
        (
            '2026-04-29,2026-04-29,"$18,450.00",382882,'
            "BOA floorplan advance 382882/M20657 VIN 5NPE24AF7KH700001,"
            "Floorplan Payable,M20657,5NPE24AF7KH700001"
        ),
        (
            '2026-04-29,2026-04-29,"$21,100.00",708021,'
            "BOA floorplan advance 708021/M20450 VIN 3FA6P0H75HR200002,"
            "Floorplan Payable,M20450,3FA6P0H75HR200002"
        ),
        (
            '2026-04-30,2026-04-30,"$17,750.00",999111,'
            "BOA floorplan advance 999111/M20999 VIN 2T3WFREV8HW300003,"
            "Floorplan Payable,M20999,2T3WFREV8HW300003"
        ),
    ]
)

DEALERTRACK_FLOORPLAN_CSV = "\n".join(
    [
        'M20500,"BOA FLOORPLAN",-25000,0',
        'M20657,"BOA FLOORPLAN",-18450,0',
        'M20450,"BOA FLOORPLAN",-21100,0',
        'M20450,"BOA FLOORPLAN DUPLICATE",-21100,0',
        'M20888,"BOA FLOORPLAN",-22600,0',
    ]
)


def test_reconciliation_matches_stock_number_patterns(client) -> None:
    _upload_floorplan_samples(client)

    response = client.post("/reconcile")

    assert response.status_code == 200
    body = response.json()
    assert body["matched_count"] == 3
    assert body["exception_count"] == 3
    assert body["duplicate_count"] == 1

    stock_matches = [
        group for group in body["match_groups"] if group["match_reason"] == "stock_number_amount"
    ]
    matched_pairs = {
        (
            group["transactions"][0]["reference_number"],
            group["transactions"][0]["stock_number"],
            group["transactions"][1]["stock_number"],
        )
        for group in stock_matches
    }

    assert ("382882", "M20657", "M20657") in matched_pairs
    assert ("708021", "M20450", "M20450") in matched_pairs


def test_stock_number_matching_succeeds_when_vin_only_matching_would_fail(client) -> None:
    _upload_floorplan_samples(client)

    response = client.post("/reconcile")

    assert response.status_code == 200
    stock_matches = [
        group
        for group in response.json()["match_groups"]
        if group["match_reason"] == "stock_number_amount"
    ]

    assert len(stock_matches) == 3
    assert all(group["transactions"][1]["vin"] is None for group in stock_matches)


def test_reconciliation_detects_duplicate_dealertrack_entry(client) -> None:
    _upload_floorplan_samples(client)

    response = client.post("/reconcile")

    assert response.status_code == 200
    body = response.json()
    duplicate_exceptions = [
        exception
        for exception in body["exceptions"]
        if exception["exception_type"] == "duplicate_transaction"
    ]

    assert body["duplicate_count"] == 1
    assert len(duplicate_exceptions) == 1
    assert duplicate_exceptions[0]["source_type"] == "dealertrack"
    assert duplicate_exceptions[0]["transaction"]["stock_number"] == "M20450"


def _upload_floorplan_samples(client) -> None:
    boa_response = client.post(
        "/upload",
        data={"source_type": "boa"},
        files={"file": ("boa_floorplan_sample.csv", BOA_FLOORPLAN_CSV, "text/csv")},
    )
    dealertrack_response = client.post(
        "/upload",
        data={"source_type": "dealertrack"},
        files={
            "file": (
                "dealertrack_floorplan_sample.csv",
                DEALERTRACK_FLOORPLAN_CSV,
                "text/csv",
            )
        },
    )

    assert boa_response.status_code == 200
    assert dealertrack_response.status_code == 200
