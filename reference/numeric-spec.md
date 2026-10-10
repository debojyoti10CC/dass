# Gaussian encoding and numerical proof

Specification date: 10 October 2026. Applies to `GaussianMath.sol`, Solidity 0.8.30, and exactly `@prb/math` 4.1.0. The numerical argument is separate from escrow conservation and is not an independent security audit.

## Mechanism and units

The [Paradigm Distribution Markets paper](https://www.paradigm.xyz/2024/12/distribution-markets) uses continuous outcome functions with a fixed L2 norm. Specializing its Gaussian construction gives:

```text
f(x; mean,sigma,k) = k / sqrt(sigma sqrt(pi))
                    * exp(-(x-mean)^2 / (2 sigma^2))
integral_R f(x)^2 dx = k^2
peak = k / sqrt(sigma sqrt(pi))
```

The numerical value of `k` is in USDC times the square root of the normalized coordinate unit. Normalized coordinates are dimensionless; changing normalization changes the interpretation of the norm. The contract stores one immutable norm per market. This MVP requires collateral `b` for every trade rather than implementing the paper's optional numerical minimum-loss calculation.

| Field | ABI encoding | Meaning |
| --- | --- | --- |
| `Curve.mean`, outcome | `int256`, WAD | Signed normalized coordinate multiplied by 10^18. |
| `Curve.sigma` | `uint256`, WAD | Positive standard deviation multiplied by 10^18. |
| `normWad` | `uint256`, WAD | Numerical norm `k` in USDC multiplied by 10^18. |
| `backingMicro`, evaluator result | `uint256`, micro-USDC | USDC multiplied by 10^6. |

One micro-USDC corresponds to 10^12 monetary WAD units. Never use native gas amounts, which have 18 decimals, directly as collateral amounts. For example `mean=-1.25` encodes as `-1250000000000000000`; `sigma=0.5` encodes as `500000000000000000`; `b=10 USDC` encodes as `10000000`.

Market rules commit to `x=(rawObservation-origin)/scale`, where `scale>0`, the raw units/precision, and publication policy. Canonical coordinates are rounded in one operation to the nearest immutable `outcomeStep` multiple, with exact halves away from zero. With `outcomeStep=1`, this is nearest WAD rounding. The helper bounds raw values/origin to ±10^38 raw WAD, scale to `[1,10^38]`, and step to `[1,10^18]`; products stay below 2×10^56, safely inside signed 256-bit range. Market outcome bounds must be step-aligned. Inputs already expressed in WAD are exact integers; no additional coordinate rounding occurs in the evaluator. The raw observation and normalization calculation belong in resolution evidence. A trusted resolver is responsible for conversion against the committed rules; `normalizeOutcome` exposes the identical conversion for clients.

## Admissible inputs

| Parameter | Inclusive range |
| --- | --- |
| Mean and normalized outcome | `[-1000e18,1000e18]` |
| Standard deviation | `[1e16,100e18]`, or `[0.01,100]` normalized units |
| Backing | `[1e6,1e9]` micro-USDC, or `[1,1000] USDC |
| Norm | `[1,1e22]` monetary WAD raw units |

Market-specific bounds may be narrower. They may not widen these library bounds. Positive sigma alone is insufficient: every admitted curve must satisfy the peak check below. A very small positive norm is allowed; absolute, rather than relative, settlement precision is guaranteed for such curves.

Let `W=10^18`, `M=10^12`, and `S0=1772453850905516027`, the downward WAD approximation of `sqrt(pi)`. The admission calculation is:

```text
A0 = floor(sigmaWad * S0 / W)
D0 = floor(sqrt(A0 * W))             # PRB UD60x18.sqrt
P0 = floor(normWad * W / D0)
admit iff P0 <= (backingMicro - 1) * M
```

This supplies a one micro-USDC safety margin. Its size exceeds the entire arithmetic approximation error before final payout rounding. The formula is equivalent to the paper's `sigma >= k^2/(b^2 sqrt(pi))`, with stricter numerical headroom. The code checks each new curve directly, so a frontend-derived minimum sigma cannot authorize an unsafe curve.

## Deterministic evaluator

After checking all inputs, compute `distance=abs(outcome-mean)`. If `distance>=8*sigmaWad`, return zero before squaring anything. Otherwise:

```text
r0 = floor(distance * W / sigmaWad)
q0 = floor(r0^2 / (2W))
e0 = PRB SD59x18.exp(-q0)            # monetary-independent WAD decay
v0 = floor(P0 * e0 / W)
F  = min(backingMicro, floor((v0 + M/2)/M))
```

The final rounding is nearest micro-USDC, exact halves upward. Every use of a stored curve uses this identical evaluator, including sponsor claims. The clamp is an accounting safeguard; the admission margin makes it inactive on correctly admitted inputs. Evaluating chart points offchain does not change this settlement procedure.

## Overflow and library-domain safety

The signed subtraction has magnitude at most `2000e18`, far below the int256 limit. Negation and conversion to unsigned are safe after coordinate validation. `8*sigma` is at most `800e18`. Inside the tail guard, `r0<8e18`, so `r0^2<64e36` and `q0<32e18`. `distance*W<=2000e36`; `sigma*S0<1.773e38`; `A0*W<1.773e38`; `normWad*W<=1e40`. These all fit within uint256.

For admitted peaks, `P0<1e21`; `e0<=1e18`; hence `P0*e0<1e39`, and addition of `M/2` is safe. The square-root radicand is positive. Exponential inputs lie in `(-32,0]`, comfortably inside PRB's signed exponential domain. Its internal positive binary-exponent inversion has integer exponent at most 46; PRB's binary products and final shifts remain in their documented domain.

These checks precede transcendental calls. No unbounded distance is squared. No new onchain exponential or square-root primitive is implemented.

## Uniform error budget over admitted inputs

The following bounds apply to the exact analytic function of the encoded inputs, before any raw-observation normalization error. Units in the final column are micro-USDC. They hold uniformly; fixture sampling provides additional evidence, rather than substituting for this argument.

1. **Peak denominator.** Write `S=sqrt(pi)` and `sigma>=0.01`. The constant error is `<10^-18`; the fixed-point product truncates by `<10^-18`. Consequently the relative radicand error is less than `10^-18/S + 10^-18/(0.01*S) < 5.8e-17`. Taking a square root contributes less than `3e-17` relative error. PRB's integer square root floors by less than one raw WAD unit; since the denominator is at least approximately `0.1331`, this contributes less than `8e-18` relative error. Use the loose combined denominator bound `1e-15`. Division adds less than one monetary WAD raw unit. With backing capped at `1e9` micro, peak error is `<0.000001000001` micro.

2. **Gaussian exponent input.** The ratio floor differs from the exact ratio by `<1e-18`. As `r<8`, the resulting `r^2/2` perturbation is `<8e-18`, and its own floor adds `<1e-18`. Therefore the absolute exponent input error is `<9e-18`. The derivative magnitude of `exp(-q)` for nonnegative `q` is at most one. This contributes `<0.000000009` micro at maximum backing.

3. **Pinned PRB exponential.** [PRB signed `exp` and `exp2`](https://github.com/PaulRBerg/prb-math/blob/v4.1.0/src/sd59x18/Math.sol) reduce `exp(-q)` to binary exponentiation and an inversion. The `LOG2_E` constant error is `<1e-18`; for `q<=32`, multiplication and truncation perturb the binary exponent by `<33e-18`. Conversion to 192.64 adds `<2^-64`. Each of the 64 factors in [PRB `Common.exp2`](https://github.com/PaulRBerg/prb-math/blob/v4.1.0/src/Common.sol) differs from its exact scaled value by less than one binary raw unit; `model.py` verifies every factor at 90 decimal digits. Thus their combined relative perturbation is bounded by `(1+2^-64)^64-1 <3.5e-18`. Intermediate product floors have relative sum less than `64/2^191`, because the internal accumulator starts at `2^191` and grows. Final conversion floors by `<1e-18`, and inversion floors by `<1e-18`; the positive inverted denominator is at least one. Combining these terms gives an absolute negative-exponential error below the deliberately loose `1e-15`. This contributes `<0.000001` micro.

4. **Monetary multiplication and rounding.** Product truncation costs `<1e-12` micro. Nearest integer rounding costs at most `0.5` micro. Combining the preceding bounds and rounding upward yields **at most `0.500003` micro-USDC absolute inner-branch error**, below the one-micro target.

The approximation to `sqrt(pi)` is downward, and integer square root is also downward. Therefore the exact analytic peak cannot exceed the computed peak by more than division's single raw monetary WAD unit. The one-micro backing margin remains ample, and the exact analytic peak is below `b`.

For the **tail branch**, the analytic peak is bounded by `b`, and `distance/sigma>=8`; therefore the omitted payout is at most `1e9*exp(-32) = 0.00001266416555` micro. This is below both the inner error budget and the one-micro target. The analytic function is still Gaussian; the cutoff is a bounded numerical implementation rule, not a bucketed outcome model.

A payout formed from two curve endpoints may accumulate both endpoint errors; its conservative absolute analytic error is at most `1.000006` micro. Integer collateral conservation remains exact despite these endpoint errors.

## Fixed norm and exact integer conservation

The analytic function has L2 norm `k` for every admitted mean and sigma. The integer rounded approximation cannot have exactly that continuous norm. The specified settlement tolerance is absolute endpoint error. For the inner interval of length `16*sigma`, writing epsilon as `0.500003e-6` USDC bounds the squared-norm deviation by `2*epsilon*integral(f)+16*sigma*epsilon^2`, plus the omitted analytic squared tail. Since `integral(f)=peak*sigma*sqrt(2*pi)`, this supplies a finite absolute norm-error bound. Relative norm accuracy is not promised for sub-micro curves.

For stored successive curves `c0,...,cn` at a final outcome:

```text
trader_i = b + F(ci) - F(ci-1)
sponsor  = b + F(c0) - F(cn)
sum       = (n+1)b
```

Every `F` lies in `[0,b]`, so each payout lies in `[0,2b]`. The curve terms telescope as integers. Claim order only changes the remaining liability; it cannot change a claim's amount. Cancellation returns one original `b` to each trader and sponsor, with zero market P&L.

The ideal paper example uses a peak exactly equal to backing. This implementation deliberately moves slightly inside the safety margin: `b=10 USDC`, initial sigma `1`, next sigma `4`, norm chosen to put the initial peak at `9.999998`. At the common mean, integer values are `9999998` and `4999999`; the trader receives `5000001` and sponsor `14999999` micro, summing to exactly `20000000`. Deposits are not fees.

## Executed evidence and reproduction

Run from the repository root after `npm ci`:

```powershell
python reference/model.py --check
```

Python 3.12's standard library is sufficient. The independent analytic oracle uses 90-digit `Decimal.sqrt` and `Decimal.exp`; the separate integer parity model reproduces the pinned PRB implementation to generate exact expected Solidity values. `--check` also compares the current pinned source SHA-256 hashes, all 64 exp2 table constants, norm/coordinate limits, fixtures, and accounting examples. Regenerate with `--write` only after deliberately reviewing a numeric-specification change.

Recorded reference result: **189 parity fixtures, 16,380 analytic comparisons**, maximum measured absolute error `0.49999999999992445` micro-USDC. The maximum fixture error is `0.49618512400642195` micro. Cases include minimum/maximum sigma and backing, sigma bounds displaced by one raw unit, signed coordinate limits, sub-micro and maximum norm, shifted means, exponent/rounding stress, tails immediately below/at the cutoff, and seeded arbitrary inputs. Twelve invalid cases are rejected. Five multi-trade scenarios verify all 120 claim orders each, totaling 600 claim-order reconciliations, and cancellation refunds.

`fixtures.json` records complete exact inputs, expected integer values, independent analytic values, measured errors, settlement examples, and dependency hashes. Solidity parity must independently execute those fixtures through the evaluator harness; reference success alone is not evidence that compiled Solidity ran. Core contract, Arc-runtime, actual testnet, and independent external review gates are distinct.

PRBMath's [security history](https://github.com/PaulRBerg/prb-math/blob/v4.1.0/SECURITY.md) lists Cantina and Certora reviews of earlier versions and explains that later changes are not covered automatically. Pinning and checking this version does not imply an audit of this application or a blanket guarantee from those reviews.
