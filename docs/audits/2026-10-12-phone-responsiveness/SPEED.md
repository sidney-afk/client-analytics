| Screen | Cold useful before / after (s) | Slowest tap before / after (ms) |
|---|---:|---:|
| Calendar | 5.59 / 5.74 | 411 / 287 |
| Samples | 5.11 / 5.18 | 71 / 76 |
| Workload | 7.21 / 7.16 | 195 / 213 |
| SyncLinear | 6.99 / 7.07 | 108 / 132 |
| Today | 5.11 / 5.19 | 73 / 86 |
| Templates | 5.17 / 5.20 | 67 / 73 |
| Filming Plans | 5.36 / 5.39 | 71 / 80 |
| Submit | 5.02 / 5.04 | 95 / 83 |
| TikTok Upload | 6.71 / 6.78 | 97 / 104 |
| Analytics | 6.80 / 6.83 | 121 / 144 |
| Reviewer | 5.54 / 5.64 | 51 / 95 |
| Time Off | 5.38 / 5.49 | 133 / 152 |
| Instagram Upload | 6.97 / 6.89 | 173 / 118 |

Native clocks, gzip, cache disabled, 4G / 4x CPU; median cold content and slowest recorded tap across 390/430 light/dark. This is a fictional backend profile, not a live service SLA.

Remaining stress miss: Calendar dark at 390, 20-card caption expansion, 287 ms against the new 250 ms budget (unchanged main: 411 ms). Cold shared bootstrap remains several seconds. Small differences in other rows are not evidence that every screen became faster.
