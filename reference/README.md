# Reference model

The independent 90-digit Python oracle, deterministic PRBMath parity model, and exact fixtures establish the admitted Gaussian range and accounting examples. Read [numeric-spec.md](numeric-spec.md) for encodings, overflow limits, backing safety margin, tails, and the uniform error argument.

After `npm ci`, run from the repository root:

```powershell
python reference/model.py --check
```

Python 3.12 standard library only; no Python dependencies are required. `--check` validates the pinned PRBMath 4.1.0 source hashes, all exponential table constants, 189 parity fixtures, 16,380 analytic comparisons, 600 claim orders, cancellation, and invalid input rejection. Maximum measured error is `0.49999999999992445` micro-USDC; the conservative uniform bound is `0.500003` micro per evaluator result.

`python reference/model.py --write` regenerates fixtures after an intentional, reviewed specification change. Solidity tests must execute `fixtures.json` through the compiled `GaussianMath` harness to establish actual cross-language parity. Reference checks do not establish Arc network compatibility or production readiness.
