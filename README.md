# Worlds Ticket Alert

Automated ticket-price monitor for the 2026 League of Legends World Championship events in Allen, Texas.

## Watched tickets

- Oct 24: Floor F, Row K, near Seat 3, one ticket
- Oct 25: Floor F, Row H, near Seat 1, one ticket
- Oct 31: Any section, two adjacent tickets
- Nov 7: Any second-level section, two adjacent tickets
- Nov 8: Section 107, with row priority R, then Q/S, then P/T, then any row, two adjacent tickets

The first successful run saves the current matching prices as baselines. A later lower price creates a GitHub issue assigned to `pearlredlove`. GitHub notification settings determine whether that issue also generates an email.

## Schedule

The workflow is configured to check every five minutes. GitHub may delay scheduled workflows during busy periods.

## Sites

The current version checks Ticketmaster and SeatGeek. Dynamic ticket sites may occasionally block automated browsers or change their page layout. Diagnostic logs are saved as workflow artifacts for seven days.

## Manual test

Open **Actions**, select **Check Worlds ticket prices**, and choose **Run workflow**.
