# Fast CSV Reader — csv-reader-speed-01-run-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/ayoobekerja8-sys/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/ayoobekerja8-sys/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0: `solve.js` answers exactly as csv-reader does on every case (`{columns, rows, errors}`), but reads the text with index-based scanning instead of one character at a time. Built for the make.fun bounty https://make.fun/bounty/csv-reader-speed-01-run-20261121

## How it works

- `solve.js` — dependency-free ES module exporting `run(input)`. Fast path: a record whose line holds no quote and no stray CR is split natively in one go; quoted and broken fields fall back to a scanner that reproduces csv-reader 1.0.0's policy exactly (BOM drop, CRLF/LF, stray CR, doubled quotes, quote junk, unterminated quote, short/long rows, blank lines).
- `main.ts` — the house driver (unchanged): reads `/input/cases.json`, answers each case with `run`, writes `/output/answers.json`.

## Run locally

```sh
MAKEFUN_INPUT_DIR=./practice/input MAKEFUN_OUTPUT_DIR=./out node main.ts
```

Node 22. No dependencies, no network, no WebAssembly.
