"""Independent 90-digit Gaussian oracle and pinned-PRB integer parity model.

No third-party Python packages are needed. Run `python reference/model.py --check`
after npm ci; --write updates deterministic fixtures after an intentional change.
The Decimal oracle evaluates the analytic formula directly. Only integer parity
expectations reproduce PRB's algorithm; they do not supply its error proof.
"""

from __future__ import annotations

import argparse
from decimal import Decimal, ROUND_HALF_UP, getcontext
import hashlib
import itertools
import json
from math import isqrt
from pathlib import Path
import random
import re

getcontext().prec = 90
D = Decimal
WAD = 10**18
MICRO_TO_WAD = 10**12
LIMIT = 1000 * WAD
MIN_SIGMA = 10**16
MAX_SIGMA = 100 * WAD
MIN_BACKING = 10**6
MAX_BACKING = 10**9
MAX_NORM = 10**22
SQRT_PI_WAD = 1772453850905516027
PI = D("3.141592653589793238462643383279502884197169399375105820974944592307816406286208998628034825342")
SQRT_PI = PI.sqrt()
ROOT = Path(__file__).resolve().parents[1]
PRB = ROOT / "node_modules" / "@prb" / "math"


def source_certificate() -> tuple[list[tuple[int, int]], int, dict]:
    package = json.loads((PRB / "package.json").read_text(encoding="utf-8"))
    assert package["version"] == "4.1.0", "The proof applies only to PRBMath 4.1.0"
    common = (PRB / "src" / "Common.sol").read_text(encoding="utf-8")
    block = common.split("function exp2(", 1)[1].split("function msb(", 1)[0]
    pairs = [(int(bit, 16), int(factor, 16)) for bit, factor in re.findall(
        r"if \(x & (0x[0-9A-F]+) > 0\) \{\s*result = \(result \* (0x[0-9A-F]+)\) >> 64;", block)]
    assert [bit for bit, _ in pairs] == [1 << i for i in range(63, -1, -1)]
    binary_scale = D(2**64)
    ln_two = D(2).ln()
    errors = []
    for bit, factor in pairs:
        exact = (ln_two * D(bit) / binary_scale).exp() * binary_scale
        errors.append(abs(D(factor) - exact))
    assert max(errors) < 1, "Every PRB exp2 table factor must be within one binary unit"
    constants = (PRB / "src" / "sd59x18" / "Constants.sol").read_text(encoding="utf-8")
    log2e = int(re.search(r"uLOG2_E = ([0-9_]+)", constants)[1].replace("_", ""))
    assert abs(D(log2e) - D(WAD) / ln_two) < 1
    assert abs(D(SQRT_PI_WAD) - SQRT_PI * WAD) < 1
    files = ["src/Common.sol", "src/sd59x18/Math.sol", "src/sd59x18/Constants.sol", "src/ud60x18/Math.sol"]
    cert = {
        "prbMathVersion": "4.1.0",
        "precisionDigits": 90,
        "exp2ConstantCount": len(pairs),
        "maxExp2ConstantErrorBinaryUnits": str(max(errors)),
        "log2eConstantErrorWadUnits": str(abs(D(log2e) - D(WAD) / ln_two)),
        "sqrtPiConstantErrorWadUnits": str(abs(D(SQRT_PI_WAD) - SQRT_PI * WAD)),
        "sourceSha256": {name: hashlib.sha256((PRB / name).read_bytes()).hexdigest() for name in files},
        "provenInnerAbsoluteErrorMicro": "0.500003",
        "provenTailAbsoluteErrorMicro": str(D(MAX_BACKING) * (-D(32)).exp()),
    }
    return pairs, log2e, cert


FACTORS: list[tuple[int, int]] = []
LOG2_E = 0


def exp_negative_wad(exponent_wad: int) -> int:
    """Reproduce pinned PRB exp(-q) for q in [0,32], integer arithmetic only."""
    assert 0 <= exponent_wad <= 32 * WAD
    if exponent_wad == 0:
        return WAD
    binary_wad = exponent_wad * LOG2_E // WAD
    binary = binary_wad * 2**64 // WAD
    result = 2**191
    for bit, factor in FACTORS:
        if binary & bit:
            result = result * factor >> 64
    positive_wad = result * WAD >> (191 - (binary >> 64))
    return WAD**2 // positive_wad


def peak_wad(sigma: int, norm: int) -> int:
    denominator = isqrt((sigma * SQRT_PI_WAD // WAD) * WAD)
    return norm * WAD // denominator


def validate(mean: int, sigma: int, norm: int, backing: int) -> None:
    if not -LIMIT <= mean <= LIMIT:
        raise ValueError("coordinate")
    if not MIN_SIGMA <= sigma <= MAX_SIGMA:
        raise ValueError("sigma")
    if not MIN_BACKING <= backing <= MAX_BACKING:
        raise ValueError("backing")
    if not 0 < norm <= MAX_NORM:
        raise ValueError("norm")
    if peak_wad(sigma, norm) > (backing - 1) * MICRO_TO_WAD:
        raise ValueError("backing margin")


def evaluate(mean: int, sigma: int, norm: int, backing: int, outcome: int) -> int:
    validate(mean, sigma, norm, backing)
    if not -LIMIT <= outcome <= LIMIT:
        raise ValueError("outcome")
    distance = abs(outcome - mean)
    if distance >= 8 * sigma:
        return 0
    ratio = distance * WAD // sigma
    exponent = ratio**2 // (2 * WAD)
    value = peak_wad(sigma, norm) * exp_negative_wad(exponent) // WAD
    return min(backing, (value + MICRO_TO_WAD // 2) // MICRO_TO_WAD)


def analytic_micro(mean: int, sigma: int, norm: int, outcome: int) -> Decimal:
    """Compute f(x) directly, without fixed-point intermediates or the tail cutoff."""
    s = D(sigma) / WAD
    dx = D(outcome - mean) / WAD
    k_usdc = D(norm) / WAD
    return k_usdc / (s * SQRT_PI).sqrt() * (-(dx**2) / (2 * s**2)).exp() * 10**6


def norm_for_peak(sigma: int, backing: int, fraction: Decimal = D("0.99")) -> int:
    denominator = isqrt((sigma * SQRT_PI_WAD // WAD) * WAD)
    return min(MAX_NORM, int(D((backing - 1) * MICRO_TO_WAD) * fraction * denominator / WAD))


def fixture(name: str, mean: int, sigma: int, norm: int, backing: int, outcome: int) -> dict:
    actual = evaluate(mean, sigma, norm, backing, outcome)
    analytic = analytic_micro(mean, sigma, norm, outcome)
    error = abs(D(actual) - analytic)
    assert error <= D("0.500003"), (name, error)
    return {
        "name": name,
        "curve": {"mean": str(mean), "sigma": str(sigma)},
        "normWad": str(norm), "backingMicro": str(backing), "outcome": str(outcome),
        "expectedMicro": str(actual), "analyticMicro": str(analytic), "errorMicro": str(error),
    }


def settlement_examples() -> list[dict]:
    b = 10_000_000
    k = int(D(10) * SQRT_PI.sqrt() * WAD * D("0.9999998"))
    curves = [(0, WAD), (0, 4 * WAD), (WAD, 2 * WAD), (-WAD, WAD), (0, WAD)]
    examples = []
    for x in [-20 * WAD, -WAD, 0, WAD, 20 * WAD]:
        values = [evaluate(m, s, k, b, x) for m, s in curves]
        trader = [b + values[i] - values[i - 1] for i in range(1, len(values))]
        sponsor = b + values[0] - values[-1]
        payouts = trader + [sponsor]
        deposits = b * len(curves)
        assert min(payouts) >= 0 and max(payouts) <= 2 * b
        # Reconcile every claim order and every intermediate liability.
        for order in itertools.permutations(range(len(payouts))):
            outstanding = deposits
            for index in order:
                assert payouts[index] <= outstanding
                outstanding -= payouts[index]
            assert outstanding == 0
        refunds = [b] * len(curves)
        assert sum(refunds) == deposits
        examples.append({
            "outcome": str(x), "backingMicro": str(b), "normWad": str(k),
            "curves": [{"mean": str(m), "sigma": str(s)} for m, s in curves],
            "valuesMicro": [str(v) for v in values], "traderPayoutsMicro": [str(v) for v in trader],
            "sponsorPayoutMicro": str(sponsor), "depositsMicro": str(deposits),
            "cancelRefundsMicro": [str(v) for v in refunds], "claimOrdersVerified": 120,
        })
    # Same-mean wider curve: collateral is 10 USDC, trader 5.000001, sponsor 14.999999.
    first = evaluate(0, WAD, k, b, 0)
    second = evaluate(0, 4 * WAD, k, b, 0)
    assert (first, second) == (9_999_998, 4_999_999)
    assert (b + second - first) + (b + first - second) == 2 * b
    return examples


def generate(cert: dict) -> dict:
    evaluations = []
    for sigma in [MIN_SIGMA, MIN_SIGMA + 1, WAD, 4 * WAD, MAX_SIGMA - 1, MAX_SIGMA]:
        for b in [MIN_BACKING, MAX_BACKING]:
            k = norm_for_peak(sigma, b, D(1))
            for ratio in [D(0), D("0.000000000000000001"), D("0.5"), D(1), D(2), D("7.999999999999999999"), D(8)]:
                x = int(ratio * sigma)
                evaluations.append(fixture(f"sigma-{sigma}-b-{b}-z-{ratio}", 0, sigma, k, b, x))
    for mean, sigma, x in [(-LIMIT, MIN_SIGMA, LIMIT), (LIMIT, MAX_SIGMA, -LIMIT),
                           (-LIMIT, MIN_SIGMA, -LIMIT), (LIMIT, MAX_SIGMA, LIMIT),
                           (-987 * WAD, WAD, -986 * WAD), (987 * WAD, WAD, 986 * WAD)]:
        evaluations.append(fixture("signed-limit-shift", mean, sigma, norm_for_peak(sigma, MAX_BACKING), MAX_BACKING, x))
    for norm in [1, 10**12, MAX_NORM]:
        evaluations.append(fixture(f"norm-boundary-{norm}", 0, MAX_SIGMA, norm, MAX_BACKING, 0))
    rng = random.Random(20261010)
    for i in range(96):
        s = rng.randrange(MIN_SIGMA, MAX_SIGMA + 1)
        mean = rng.randrange(-LIMIT, LIMIT + 1)
        b = rng.randrange(MIN_BACKING, MAX_BACKING + 1)
        k = norm_for_peak(s, b, D(rng.randrange(1, 1000001)) / 1000000)
        x = max(-LIMIT, min(LIMIT, mean + rng.randrange(-9 * s, 9 * s + 1)))
        evaluations.append(fixture(f"seeded-{i}", mean, s, k, b, x))
    # Independent dense sweep exercises rounding thresholds and exponential bits.
    maximum = D(0)
    count = 0
    for s in [MIN_SIGMA, MIN_SIGMA + 1, WAD // 3, WAD, 4 * WAD, MAX_SIGMA - 1, MAX_SIGMA]:
        for b in [MIN_BACKING, 10_000_000, MAX_BACKING]:
            for fraction in [D("0.00000001"), D("0.5"), D(1)]:
                k = max(1, norm_for_peak(s, b, fraction))
                for i in range(257):
                    x = 8 * s * i // 256
                    error = abs(D(evaluate(0, s, k, b, x)) - analytic_micro(0, s, k, x))
                    maximum = max(maximum, error)
                    assert error <= D("0.500003")
                    count += 1
    maximum = max(maximum, max(D(row["errorMicro"]) for row in evaluations))
    cert["measuredEvaluationCount"] = count + len(evaluations)
    cert["maximumMeasuredErrorMicro"] = str(maximum)
    cert["maximumFixtureErrorMicro"] = str(max(D(row["errorMicro"]) for row in evaluations))
    return {
        "encoding": {"coordinates": "signed WAD, 18 decimals", "sigma": "unsigned WAD, 18 decimals",
                     "norm": "USDC WAD, 18 decimals", "collateral": "micro-USDC, 6 decimals",
                     "rounding": "nearest micro-USDC; exact halves upward", "tail": "|x-mean| >= 8 sigma returns zero"},
        "certificate": cert, "evaluations": evaluations, "settlementExamples": settlement_examples(),
    }


def invalid_inputs() -> None:
    valid = [0, WAD, norm_for_peak(WAD, MIN_BACKING), MIN_BACKING]
    cases = [(0, LIMIT + 1), (0, -LIMIT - 1), (1, 0), (1, MIN_SIGMA - 1),
             (1, MAX_SIGMA + 1), (2, 0), (2, MAX_NORM + 1), (3, MIN_BACKING - 1),
             (3, MAX_BACKING + 1), (2, MAX_NORM)]
    for index, value in cases:
        bad = valid.copy()
        bad[index] = value
        try:
            validate(*bad)
        except ValueError:
            pass
        else:
            raise AssertionError(f"invalid input admitted: {bad}")
    for x in [-LIMIT - 1, LIMIT + 1]:
        try:
            evaluate(*valid, x)
        except ValueError:
            pass
        else:
            raise AssertionError("invalid outcome admitted")


def main() -> None:
    global FACTORS, LOG2_E
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true")
    mode.add_argument("--check", action="store_true")
    args = parser.parse_args()
    FACTORS, LOG2_E, certificate = source_certificate()
    invalid_inputs()
    result = generate(certificate)
    path = Path(__file__).with_name("fixtures.json")
    if args.write:
        path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    else:
        assert json.loads(path.read_text(encoding="utf-8")) == result, "Fixtures changed: inspect and regenerate with --write"
    print(json.dumps({"status": "passed", "fixtures": len(result["evaluations"]),
                      "evaluations": result["certificate"]["measuredEvaluationCount"],
                      "maximumErrorMicro": result["certificate"]["maximumMeasuredErrorMicro"],
                      "claimOrders": 600, "invalidCases": 12}, indent=2))


if __name__ == "__main__":
    main()
