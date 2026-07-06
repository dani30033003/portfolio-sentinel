# 0001 — IB Gateway 2FA handling

## Status

Accepted

## Context

IB Gateway auto-login is handled by IBC inside the `gnzsnz/ib-gateway` container. The
account uses IBKR Mobile push-notification 2FA (IB Key). Two facts constrain this:

- 2FA cannot be disabled for paper trading accounts (confirmed as of Feb 2025) — this is
  not something specific to this account, so there's no config path around it.
- IBC cannot complete the 2FA approval itself. Per the IBC user guide: "IBC cannot itself
  assist in the process, so you'll have to actually perform the necessary actions on your
  device yourself." Every cold login needs a manual tap on the IBKR Mobile app.

The mitigating factor: IB Gateway sessions survive routine restarts without re-prompting,
*provided* the restart lines up with IBKR's own forced daily restart window. The image
exposes `AUTO_RESTART_TIME` for exactly this — the docs describe it as a restart that
"does not require daily 2FA validation."

## Decision

- `AUTO_RESTART_TIME=03:00 AM`, `TIME_ZONE=Asia/Jerusalem` — scheduled restart overnight,
  outside US market hours (~16:30–23:00 Asia/Jerusalem), so steady-state operation needs
  no manual 2FA interaction.
- A real crash or manual `docker compose down`/`up` still requires a manual phone tap.
  We are not adding `TWOFA_TIMEOUT_ACTION`/`RELOGIN_AFTER_TWOFA_TIMEOUT` retry config yet —
  holding off until the initial bring-up spike shows what default behavior actually looks
  like (do not tune knobs for a failure mode we haven't observed).
- This is why the existing gateway health-check design (§8 of the spec — ping
  `healthCheck()` every 5 min, WhatsApp-alert if down >10 min) matters operationally, not
  just architecturally: a crash-restart needing a phone tap *is* the "gateway down" case
  the alert already exists to catch.

## Consequences

- No unattended crash recovery for the gateway connection — a real outage requires the
  human to notice the WhatsApp alert and physically approve the login.
- If `AUTO_RESTART_TIME` drifts out of sync with IBKR's actual restart cycle (e.g. after a
  DST change), the scheduled restart could start prompting for 2FA again. Worth re-checking
  after the first Asia/Jerusalem DST transition post-deploy.
