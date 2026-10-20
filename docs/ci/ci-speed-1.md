# CI critical-path timing

Baseline: the newest 15 completed CI runs by creation order, captured before editing the workflow on 2026-10-20. All conclusions are retained, including cancellations, a failed merge group, a duplicate-tree push, and one retried run.

Times below are on 2026-10-20 in America/Los_Angeles (PDT, UTC-07:00). Wall time is run creation to the latest actual job completion. API updated_at is excluded because later metadata can change it. Original executions are deduplicated by job name/start/completion; carried-forward retry records retain old start/end times but receive new creation times and must not become negative queue measurements.

| Run | Event / result / attempt | Created | First job start | Last job end | Wall seconds | README seconds | Build/test seconds | npm test seconds |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| [39441057888](https://github.com/clossys/foundry/actions/runs/39441057888) | merge_group / failure / 1 | 07:38:22 | 07:38:25 | 08:18:14 | 2392 | 1458 | 875 | 595 |
| [39438414611](https://github.com/clossys/foundry/actions/runs/39438414611) | pull_request / success / 1 | 07:21:03 | 07:21:07 | 07:54:35 | 2012 | 1073 | 912 | 667 |
| [39437729361](https://github.com/clossys/foundry/actions/runs/39437729361) | pull_request / success / 2 | 07:16:31 | 07:16:35 | 07:52:51 | 2180 | 1489 | 509 | 356 |
| [39435651827](https://github.com/clossys/foundry/actions/runs/39435651827) | pull_request / success / 1 | 07:02:20 | 07:02:24 | 07:36:25 | 2045 | 1386 | 636 | 450 |
| [39434378968](https://github.com/clossys/foundry/actions/runs/39434378968) | pull_request / success / 1 | 06:53:45 | 06:53:49 | 07:21:17 | 1652 | 953 | 678 | 484 |
| [39434181083](https://github.com/clossys/foundry/actions/runs/39434181083) | pull_request / success / 1 | 06:52:26 | 06:52:29 | 07:30:50 | 2304 | 1402 | 877 | 615 |
| [39431184188](https://github.com/clossys/foundry/actions/runs/39431184188) | pull_request / success / 1 | 06:31:53 | 06:31:56 | 07:07:24 | 2131 | 1451 | 658 | 476 |
| [39430543115](https://github.com/clossys/foundry/actions/runs/39430543115) | push / success / 1 | 06:27:28 | 06:27:31 | 06:27:44 | 16 | 0 | -1 | - |
| [39430297369](https://github.com/clossys/foundry/actions/runs/39430297369) | pull_request / success / 1 | 06:25:43 | 06:25:46 | 07:04:08 | 2305 | 1453 | 832 | 614 |
| [39428515289](https://github.com/clossys/foundry/actions/runs/39428515289) | pull_request / success / 1 | 06:13:03 | 06:13:07 | 06:46:33 | 2010 | 1104 | 885 | 646 |
| [39425980715](https://github.com/clossys/foundry/actions/runs/39425980715) | merge_group / success / 1 | 05:54:40 | 05:54:43 | 06:26:52 | 1932 | 1343 | 567 | 407 |
| [39424504728](https://github.com/clossys/foundry/actions/runs/39424504728) | pull_request / success / 1 | 05:43:33 | 06:02:20 | 06:32:54 | 2961 | 1046 | 766 | 553 |
| [39424504664](https://github.com/clossys/foundry/actions/runs/39424504664) | pull_request / cancelled / 1 | 05:43:33 | 05:43:34 | 06:02:17 | 1124 | 1111 | 5 | 0 |
| [39421102352](https://github.com/clossys/foundry/actions/runs/39421102352) | pull_request / success / 1 | 05:17:11 | 05:32:26 | 06:06:12 | 2941 | 1472 | 536 | 385 |
| [39420947931](https://github.com/clossys/foundry/actions/runs/39420947931) | pull_request / success / 1 | 05:15:57 | 05:18:02 | 05:53:11 | 2234 | 1447 | 638 | 454 |

The 11 successful, first-attempt runs that actually executed both README validation and root tests have median wall time 2131s (35.52min), range 1652–2961s. Every other observation remains above; it is excluded from the performance comparison because it skipped work, was cancelled/failed, or includes manual retry delay.

## Every job: created / started / completed

Each cell gives C/S/E seconds relative to that column run's creation, followed by S=success, F=failure, C=cancelled, or K=skipped. A dash means the job was absent or the timestamp was unavailable. Multiple actual attempts are separated by a semicolon. Skipped GitHub records can end before their synthetic creation/start timestamp; these raw values are retained and are not runner durations. The three tables cover all jobs rather than only the critical branch.

| Job | 39441057888 | 39438414611 | 39437729361 | 39435651827 | 39434378968 |
| --- | --- | --- | --- | --- | --- |
| README code examples typecheck against shipped declarations | 53/56/1514S | 20/23/1096S | 19/22/1511S | 17/20/1406S | 15/18/971S |
| WCAG contrast gate (designer-contrast-check) | 53/56/89S | 20/23/51S | 19/22/49S | 17/20/52S | 15/18/41S |
| WCAG contrast gate (ui-contrast-check) | 53/55/82S | 20/23/60S | 19/22/54S | 17/20/46S | 15/18/50S |
| artifact safety (tarball) | 165/168/200S | 152/155/185S | 126/129/158S | 143/146/178S | 141/144/172S |
| artifact safety (tarball) / pack | 53/55/164S | 20/23/151S | 19/22/126S | 17/20/143S | 15/18/141S |
| attestation freshness (early warning, non-blocking) | 12/15/27S | 8/11/38S | 9/12/23S | 6/10/24S | 8/11/25S |
| build and test | 1515/1517/2392F | 1097/1100/2012S | 1513/1516/2025S | 1406/1409/2045S | 971/974/1652S |
| candidate qualification records | 188/190/197S | 148/151/161S | 156/159/163S | 147/150/154S | 143/145/147S |
| candidate qualification records (shard ${{ matrix.shard }}) | - | - | - | - | - |
| candidate qualification records (shard 0) | 53/56/187S | 20/23/111S | 19/22/156S | 17/20/135S | 15/18/134S |
| candidate qualification records (shard 1) | 53/55/147S | 20/23/108S | 19/22/114S | 17/19/143S | 15/20/120S |
| candidate qualification records (shard 2) | 53/56/186S | 20/23/147S | 19/22/145S | 17/20/145S | 15/18/109S |
| candidate qualification records (shard 3) | 53/56/168S | 20/23/144S | 19/22/142S | 17/20/147S | 15/18/142S |
| classify change tier | 1/4/52S | 1/4/19S | 1/4/19S | 1/4/16S | 1/4/15S |
| controller gates (catalog, neutrality, repository-profile) | 53/56/95S | 20/26/57S | 19/22/50S | 17/19/41S | 15/18/44S |
| credential lifecycle (dependency-audit token) | 79/83/111S | 55/58/87S | 48/51/78S | 50/53/82S | 43/46/74S |
| dependency audit | 53/56/79S | 20/22/53S | 19/22/48S | 17/20/49S | 15/18/43S |
| package state (declared vs. evidence) | 53/57/130S | 20/23/101S | 19/22/326C; 2090/2093/2180S | 17/20/129S | 15/18/99S |
| packed consumer readiness | 53/56/511S | 20/24/629S | 19/22/614S | 17/20/601S | 15/18/474S |
| prepublish hook drift | 53/56/68S | 20/23/34S | 19/22/32S | 17/19/30S | 15/18/28S |
| prose quality (README parity, contamination classes) | 12/14/60S | 8/11/60S | 9/13/61S | 7/10/56S | 8/11/58S |
| publish safety | 896/899/902S | 801/804/808S | 969/972/974S | 1020/1023/1025S | 1001/1004/1007S |
| publish safety / gate regression tests | 12/15/896S | 8/11/801S | 9/12/969S | 6/9/1020S | 8/11/1001S |
| publish safety / gitleaks | 12/14/27S | 8/11/26S | 9/12/22S | 6/9/20S | 8/11/26S |
| publish safety / identity | 12/15/59S | 8/11/50S | 9/13/58S | 6/9/50S | 8/11/54S |
| push-tree identity | 1/4/11S | 1/4/8S | 1/4/9S | 1/4/6S | 1/4/7S |
| qualification record required (version bump vs. retained record) | 53/56/83S | 20/23/48S | 19/22/52S | 17/20/54S | 15/18/49S |
| registry drift | 53/56/67S | 20/22/33S | 19/22/34S | 17/20/33S | 15/18/31S |
| release PR shape (version bump vs. changeset/CHANGELOG) | 1/1/0K | 1/10/42S | 1/4/37S | 1/4/35S | 1/4/37S |
| release readiness (version bump vs. shipped content) | 0/3/28S | 1/4/34S | 1/4/33S | 1/4/30S | 1/4/29S |
| role-loop archetypes | 53/55/84S | 20/23/40S | 19/22/38S | 17/20/33S | 15/26/40S |
| root entry policy drift | 53/56/70S | 20/23/33S | 19/22/35S | 17/20/29S | 15/18/31S |
| scope drift | 53/56/226S | 20/23/207S | 19/22/211S | 17/19/176S | 15/18/217S |
| secret-scan (inspector judgment) | 28/30/63S | 27/30/242S | 22/25/64S | 20/23/60S | 26/28/63S |
| workspace link integrity | 53/56/66S | 20/23/39S | 19/22/35S | 17/19/31S | 15/18/29S |

| Job | 39434181083 | 39431184188 | 39430543115 | 39430297369 | 39428515289 |
| --- | --- | --- | --- | --- | --- |
| README code examples typecheck against shipped declarations | 18/21/1423S | 16/19/1470S | 16/16/16K | 15/17/1470S | 15/18/1122S |
| WCAG contrast gate (designer-contrast-check) | 18/22/57S | 16/19/50S | 16/16/16K | 15/18/43S | 15/18/50S |
| WCAG contrast gate (ui-contrast-check) | 18/22/52S | 16/19/51S | 16/16/16K | 15/18/53S | 15/18/51S |
| artifact safety (tarball) | 138/140/167S | 138/141/166S | 17/17/16K | 132/135/157S | 115/118/144S |
| artifact safety (tarball) / pack | 18/21/137S | 16/19/138S | 17/17/16K | 15/18/131S | 15/18/114S |
| attestation freshness (early warning, non-blocking) | 9/12/24S | 7/10/20S | 16/16/16K | 7/10/20S | 10/14/26S |
| build and test | 1424/1427/2304S | 1471/1473/2131S | 17/17/16K | 1470/1473/2305S | 1122/1125/2010S |
| candidate qualification records | 140/143/145S | 141/143/146S | 17/17/16K | 147/150/153S | 145/147/150S |
| candidate qualification records (shard ${{ matrix.shard }}) | - | - | 16/16/16K | - | - |
| candidate qualification records (shard 0) | 18/21/125S | 16/20/119S | - | 15/18/147S | 15/18/108S |
| candidate qualification records (shard 1) | 18/21/112S | 16/20/126S | - | 15/18/145S | 15/19/144S |
| candidate qualification records (shard 2) | 18/21/109S | 16/20/140S | - | 15/18/139S | 15/18/137S |
| candidate qualification records (shard 3) | 18/21/140S | 16/19/139S | - | 15/18/133S | 15/18/106S |
| classify change tier | 0/3/17S | 1/4/16S | 1/4/15S | 0/3/14S | 1/4/15S |
| controller gates (catalog, neutrality, repository-profile) | 18/21/44S | 16/19/52S | 16/16/16K | 15/17/44S | 15/18/50S |
| credential lifecycle (dependency-audit token) | 53/56/77S | 38/41/63S | 17/17/16K | 37/40/67S | 43/46/74S |
| dependency audit | 18/22/52S | 16/19/38S | 16/16/16K | 15/17/36S | 15/18/43S |
| package state (declared vs. evidence) | 18/22/78S | 16/19/83S | 16/16/16K | 15/17/89S | 15/19/103S |
| packed consumer readiness | 18/21/388S | 16/20/633S | 17/17/16K | 15/17/386S | 15/18/611S |
| prepublish hook drift | 18/22/36S | 16/19/30S | 16/16/16K | 15/18/29S | 15/18/30S |
| prose quality (README parity, contamination classes) | 9/12/45S | 7/10/49S | 17/17/16K | 7/10/50S | 10/13/58S |
| publish safety | 680/683/685S | 961/964/967S | 17/17/16K | 921/924/926S | 990/993/995S |
| publish safety / gate regression tests | 9/12/680S | 7/10/961S | 16/16/16K | 7/10/921S | 10/13/989S |
| publish safety / gitleaks | 9/12/26S | 7/10/22S | 16/16/16K | 7/10/21S | 10/14/27S |
| publish safety / identity | 9/12/51S | 7/9/49S | 16/16/16K | 7/10/48S | 10/13/45S |
| push-tree identity | 0/4/8S | 1/3/6S | 1/3/16S | 0/3/7S | 1/5/10S |
| qualification record required (version bump vs. retained record) | 18/21/54S | 16/19/53S | 16/16/15K | 15/18/50S | 15/18/42S |
| registry drift | 18/22/32S | 16/19/29S | 17/17/16K | 15/17/27S | 15/18/29S |
| release PR shape (version bump vs. changeset/CHANGELOG) | 0/3/34S | 1/3/26S | 1/1/0K | 0/3/33S | 1/5/38S |
| release readiness (version bump vs. shipped content) | 0/3/34S | 1/4/38S | 1/1/0K | 0/3/31S | 1/4/27S |
| role-loop archetypes | 18/21/35S | 16/19/35S | 16/16/16K | 15/18/33S | 15/18/32S |
| root entry policy drift | 18/22/35S | 16/19/29S | 17/17/16K | 15/18/29S | 15/18/28S |
| scope drift | 18/21/202S | 16/19/244S | 16/16/16K | 15/17/231S | 15/19/227S |
| secret-scan (inspector judgment) | 27/30/62S | 22/25/58S | 17/17/16K | 22/24/47S | 27/30/59S |
| workspace link integrity | 18/22/35S | 16/19/30S | 16/16/16K | 15/18/31S | 15/18/28S |

| Job | 39425980715 | 39424504728 | 39424504664 | 39421102352 | 39420947931 |
| --- | --- | --- | --- | --- | --- |
| README code examples typecheck against shipped declarations | 15/19/1362S | 1142/1146/2192S | 2/5/1116S | 926/930/2402S | 142/145/1592S |
| WCAG contrast gate (designer-contrast-check) | 15/19/47S | 1142/1146/1181S | 2/5/29S | 926/929/962S | 142/145/175S |
| WCAG contrast gate (ui-contrast-check) | 15/18/52S | 1142/1145/1178S | 2/5/41S | 926/929/960S | 142/145/178S |
| artifact safety (tarball) | 113/115/140S | 1260/1263/1289S | 98/101/125S | 1047/1049/1074S | 268/271/297S |
| artifact safety (tarball) / pack | 15/19/112S | 1142/1145/1260S | 2/5/97S | 926/929/1046S | 142/145/268S |
| attestation freshness (early warning, non-blocking) | 8/10/21S | 1130/1133/1143S | 2/2/2C | 919/921/932S | 128/131/141S |
| build and test | 1363/1365/1932S | 2192/2195/2961S | 1116/1119/1124F | 2402/2405/2941S | 1593/1596/2234S |
| candidate qualification records | 142/145/147S | 1272/1275/1278S | 2/6/8F | 1049/1052/1054S | 268/270/273S |
| candidate qualification records (shard ${{ matrix.shard }}) | - | - | - | - | - |
| candidate qualification records (shard 0) | 15/19/141S | 1142/1146/1268S | - | 926/929/1048S | 142/145/267S |
| candidate qualification records (shard 1) | 15/19/142S | 1142/1146/1245S | - | 926/929/1049S | 142/145/237S |
| candidate qualification records (shard 2) | 15/18/140S | 1142/1145/1272S | - | 926/930/1046S | 142/145/257S |
| candidate qualification records (shard 3) | 15/18/140S | 1142/1145/1270S | - | 926/929/1020S | 142/145/238S |
| classify change tier | 1/3/15S | 1125/1128/1142S | 1/1/2C | 912/915/926S | 123/125/141S |
| controller gates (catalog, neutrality, repository-profile) | 15/18/39S | 1142/1145/1178S | 2/5/37S | 926/930/955S | 142/145/172S |
| credential lifecycle (dependency-audit token) | 41/50/76S | 1171/1174/1198S | 30/33/56S | 949/952/972S | 172/175/204S |
| dependency audit | 15/18/41S | 1142/1145/1171S | 2/5/30S | 926/929/949S | 142/145/172S |
| package state (declared vs. evidence) | 15/18/75S | 1142/1145/1221S | 2/5/64S | 926/929/993S | 142/145/231S |
| packed consumer readiness | 15/19/472S | 1142/1146/1669S | 2/5/555S | 926/929/1485S | 142/145/762S |
| prepublish hook drift | 15/18/28S | 1142/1146/1158S | 2/5/15S | 926/929/939S | 142/144/157S |
| prose quality (README parity, contamination classes) | 8/11/57S | 1130/1133/1179S | 2/2/2C | 919/922/966S | 128/131/178S |
| publish safety | 887/890/892S | 2072/2075/2079S | 2/6/8F | 1883/1885/1889S | 1135/1138/1142S |
| publish safety / gate regression tests | 8/10/887S | 1130/1133/2072S | 2/2/2C | 919/921/1882S | 128/131/1134S |
| publish safety / gitleaks | 8/10/21S | 1130/1133/1142S | 2/2/2C | 919/922/935S | 128/131/144S |
| publish safety / identity | 8/11/53S | 1130/1133/1174S | 2/2/2C | 919/922/966S | 128/131/171S |
| push-tree identity | 1/4/7S | 1125/1127/1130S | 1/1/2C | 912/915/919S | 123/125/128S |
| qualification record required (version bump vs. retained record) | 15/19/49S | 1142/1145/1176S | 2/5/33S | 926/929/958S | 142/145/176S |
| registry drift | 15/19/29S | 1142/1145/1155S | 2/5/16S | 926/930/941S | 142/145/156S |
| release PR shape (version bump vs. changeset/CHANGELOG) | 1/1/1K | 1125/1128/1160S | 1/1/2C | 912/915/938S | 123/125/148S |
| release readiness (version bump vs. shipped content) | 1/3/34S | 1125/1128/1159S | 1/1/2C | 912/915/947S | 123/126/156S |
| role-loop archetypes | 15/18/34S | 1142/1145/1161S | 2/5/19S | 926/929/944S | 142/145/158S |
| root entry policy drift | 15/19/29S | 1142/1146/1156S | 2/5/18S | 926/928/939S | 142/146/159S |
| scope drift | 15/18/226S | 1142/1146/1312S | 2/5/173S | 926/929/1146S | 142/145/316S |
| secret-scan (inspector judgment) | 21/24/56S | 1142/1145/1176S | 2/6/38F | 935/937/965S | 144/148/175S |
| workspace link integrity | 15/18/31S | 1142/1145/1157S | 2/5/16S | 926/930/943S | 142/145/157S |

## Measurement and change boundary

The build/test job is created only after README validation ends. It spends another 509–912s in the successful sampled runs; npm test accounts for 356–667s. Those tests can execute independently while the existing required build and test context continues to fail closed over every prior dependency and the new test result.

The existing source/lockfile build cache remains exact, with a full build on a miss. No required context name, check, existing condition, timeout, ruleset, or merge-queue policy is removed or weakened.

A README sample (run 39434181083, job 118666888280) spends about 1,297s in the checker after setup/build: Designer takes about 561s for 138 fences and Publisher 265s for 63. This is primarily work proportional to examples, rather than a uniform fixed package startup cost. The README checker and its invocation remain unchanged in this critical-path split.

## Hosted comparison

Two planned, completed hosted observations must show the root-test interval overlapping README validation, unchanged required contexts, and at least 480s less wall time than the 2,131s comparable baseline median. Queue delay, cache result, source head/tree, run identity, conclusions, and actual execution timestamps must be recorded separately. A red run is evidence, never permission to retry until green.

Hosted measurements are pending; no speedup is claimed yet. After hosted run 1 is GREEN, one timing-note commit records it. The final run 2 exact-head timings and both measured deltas go in the sole terminal issue comment, as agreed for this unit. This avoids a third evidence-only push and its additional CI run.
