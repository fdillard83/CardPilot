# CardPilot accuracy library

`fixtures.sample.json` is the first repeatable card-identification baseline. A
fixture names a front image, an optional back image, optional pre-generated
front detail crops, and only the fields whose ground truth has been verified by
the collector.

With CardPilot running locally, execute:

```powershell
npm.cmd run eval:accuracy
```

The runner calls the existing `/api/identify-card` route, prints every expected
and actual value, reports the server's elapsed time, and exits unsuccessfully
if any verified field regresses. OpenAI usage is billed normally, so this suite
is intentionally separate from `npm test`.

Before expanding the baseline, verify the physical card rather than inferring
ground truth from a filename or an active listing. Exact serial stamps must come
from the collector's own card image.
