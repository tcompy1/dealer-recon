# Dealertrack Workflow Notes

Status note: raw historical manual-cleaning notes. Use these only as source evidence for Hurst Dealertrack and FP REC behavior; the canonical v1 workflow is `docs/product/fp-rec-four-step-workflow.md`.

- remove Straightline row
- for this store we remove column 2110
- sort, custom sort, add level, data has headers, sort largest to smalls, then sort vin6 A to Z
- Format numbers to accounting no symbol
- transpose cols, cut table and merge into BOA statment, auto sum totals
- insert col between 2100 and VIN6 on DT side, =D2 + E2, copy formula down
- manipulate rows so VIN6 on BOA and DT sides align.
- insert col VIN6 description on DT SIDE between 2100 and description, =C2 - F2 copy down.

- move exceptions to FP REC 

# FP REC
 - outstanding per stmt = sum(ending balance BOA side)
 - Total GL = sum(2100 DT SIDE)

 - say whats wrong on DT and BOA
 - variances match
