#!/usr/bin/env python3
"""Explicit operator signal; protected URLs are read from fixed local files."""
import argparse
from monitor_common import CHECKS, send

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('check', choices=sorted(CHECKS))
    parser.add_argument('signal', choices=['start', 'success', 'fail'])
    args = parser.parse_args()
    raise SystemExit(0 if send(args.check, args.signal) else 1)
