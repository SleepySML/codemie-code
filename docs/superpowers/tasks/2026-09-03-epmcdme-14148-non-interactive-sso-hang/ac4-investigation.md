# AC4 — `ERR_USE_AFTER_CLOSE` on kill: investigation result

**Acceptance criterion:** "Killing during prompt does not produce readline lifecycle crash."

**Verdict: precondition not constructed — the criterion was never exercised.**

This is deliberately *not* "cannot reproduce". Every attempt exited before the interactive prompt was reached, so the scenario the criterion describes — killing the process *while it sits on the prompt* — was never actually set up. Ten attempts at failing to reach the prompt is zero attempts at the criterion. "Cannot reproduce the crash" and "cannot construct the precondition" are different claims, and only the second is supported by what follows.

## What was run

A node-pty probe (`ac4-probe.mjs`, throwaway) driving a **real** pty — not `script`, whose artifacts are discussed below. Isolated `CODEMIE_HOME` per attempt, with the real config copied in (never credentials) so the `sso` provider resolves.

8 attempts: 4 interrupt modes (`Ctrl-C` as raw `\x03`, `SIGINT`, `SIGTERM`, `SIGHUP`) × 2 delays (1.5 s, 4 s).

| Result | Across all 8 |
|---|---|
| `ERR_USE_AFTER_CLOSE` occurrences | **0** |
| Any `readline` mention | **0** |
| Reached the re-auth prompt | **0** |
| Exit | `code=1, signal=0` every time |
| Max output | 1 470 bytes |

Plus the 2 earlier `script`-based attempts in `reproduction.md`. **10 attempts total, zero hits.**

## Why the prompt was never reached

Every attempt exited cleanly in well under 1.5 s — before any signal was delivered. The process reaches `No valid SSO credentials found` and terminates with the actionable message. `promptReauthentication`'s interactive branch is never entered in a clean-room home, so "kill *during* the prompt" was never actually exercised.

Reproducing AC4 would need an environment where `promptForReauth` is genuinely reached — most plausibly a home with *stale but present* credentials for a matching URL, rather than absent ones. That is the reporter's environment, which this investigation could not recreate from the ticket text.

## Two earlier observations retracted

Both were `script`-harness artifacts, not product defects. Recording them so nobody re-derives them:

**1. The "73 MB ora escape-sequence flood" is not real.** Under a real pty the same command produces **1 470 bytes**. The flood only appears under `script`, consistent with the original guess that `script` yields a pty with no usable `stdout.columns`, breaking ora's line-clearing arithmetic.

**2. The "Case C TTY hang" is not the re-auth prompt.** Originally read as proof that attaching a TTY parks execution on the prompt. Three facts refute it:

- The identical `script` invocation against the **fixed** build still hangs 25 s.
- `script` wrapping an immediately-exiting child returns in 0 s, so `script` does not hang unconditionally.
- The `script` capture stalls at `⠋ Loading configuration...`, *before* credentials are read, and contains a stray `^D` — the signature of an immediately-EOF stdin being forwarded into the pty.

Under node-pty the same command completes in under 1 s. The non-TTY guard is still confirmed working — by `auth-validation.test.ts` and by Cases A/B exiting in 0–1 s without prompting — but **not** by Case C.

**Methodological note:** `script(1)` is unsuitable for CLI behaviour testing here. It injects its own stdin and terminal-geometry behaviour. Use `node-pty` (already a dependency, wrapped by `tests/helpers/pty-session.ts`) for anything TTY-dependent.

## Recommendation

Split AC4 into its own ticket. Do **not** close it against this MR — neither as satisfied nor as "not reproducible", since the criterion was never exercised.

Carry this reproduction recipe over, which the code review identified and this investigation stopped one step short of building:

> `sso.setup-steps.ts` `validateAuth` returns `{valid: false, error: 'API access test failed: …'}` whenever `fetchCodeMieModels` throws, and that result reaches `promptForReauth`'s `inquirer.prompt`. So: plant a credentials file whose `apiUrl` points at a **closed local port**. `validateAuth` then fails deterministically with no network dependency, the prompt *is* reached, and `tests/helpers/pty-session.ts` can drive a signal into it. The missing precondition is stale-but-present credentials — not absent ones, which is all this investigation ever tested.

**Retracted claim.** An earlier draft of this document argued that "the spinner suppression in this MR removes one plausible contributor (a spinner writing to a torn-down TTY)". **That is false and has been struck.** The suppression added in `sdk-client.ts` is gated on `isNonInteractiveEnvironment()`, so it fires only when **no** TTY is attached — while AC4's scenario requires a TTY by definition. It can never fire there. The spinner implicated in the original escape-sequence observation is the one inside `promptForReauth` (`sso.setup-steps.ts:294`), which this MR does not touch. That sentence was the sole justification offered for shipping without AC4, and it did not survive inspection; nothing in this MR mitigates AC4, partially or otherwise.

The one part of the original conclusion that stands: **do not ship a speculative fix** for a failure mode with no reproduction.
