# IVI / HMI Test Engineer — Interview Prep

A free, beginner-friendly study website for a **manual test engineer role in automotive HMI / infotainment (IVI)**, aimed at candidates with 1–2 years of experience.

It explains everything in simple English, from "what is an ECU?" to regression strategy and boundary value analysis, with pictures, interactive tools, a mock CANoe/CAPL lab, spot-the-defect drills, 130 interview questions with model answers, a quiz, flashcards and a 397-word dictionary.

**Word help:** hard words on every page have a dotted underline. Tap one to see a simple meaning (turn it off with the **Aa** button). This helps readers whose first language is not English.

## Chapters

| # | Page | What you learn |
|---|------|----------------|
| 0 | Home & study plan | 7-day / 2-day / last-hour plans, top-10 questions |
| 1 | The job explained simply | What an HMI test engineer does all day |
| 2 | Learn with pictures | 17 simple diagrams + the top 10 answers in very simple English |
| 3 | Car electronics basics | ECU, CAN, DBC, signals, KL15/KL30, HIL, DTC/UDS |
| 4 | HMI & IVI features | Cluster, telltales, media, phone, nav, camera, what to test |
| 5 | Testing basics (ISTQB) | Principles, V-model, levels, types, STLC, test plan |
| 6 | Test design & BVA | EP, BVA, the snowflake question, decision tables, state transitions |
| 7 | Bugs, Jira & defect reports | Bug report fields, severity/priority, life cycle, duplicates, when not to raise |
| 8 | Retest & regression | Regression strategy, choosing tests, what to add |
| 9 | Automation execution | Robot Framework, Python, Jenkins, failure triage |
| 10 | Tools, traces & logs | CANoe, CAPL, .asc traces, DLT, ADB, log analysis |
| 11 | CANoe & CAPL lab (mock) | A pretend CANoe/CANalyzer in the browser: trace, panel, graphics, IG, DBC, CAPL editor, test module + report, 12 lessons |
| 12 | Spot-the-defect drills | 7 screens, 72 defects, answers shown on the image |
| 13 | Interview Q&A | 130 questions with short and long answers |
| 14 | Quiz & flashcards | 67 multiple-choice questions + 397 vocabulary cards |
| 15 | Final prep | Self-introduction templates, STAR stories, checklists |
| — | Dictionary A–Z | 248 technical terms + 149 everyday English words |
| — | Cheat sheet | Everything on one printable page |

## About the CANoe lab

`canoe-lab.html` + `assets/canoe-lab.js` simulate a small CAN bus in the browser: a mock DBC (6 messages), rest-bus simulation of 4 ECUs, a mock instrument cluster as the device under test (with bugs you can switch on), and an interpreter for a small subset of CAPL (`variables`, `on start`, `on message`, `on timer`, `on key`, `on signal`, `testcase`, `MainTest`, `write`, `output`, `setTimer`, `$Signal`, `testStepPass/Fail`, `TestWaitForTimeout`). It is a learning toy, not Vector software, and it is not affiliated with Vector Informatik.

## Run it locally

It's plain HTML, CSS and JavaScript with no build step. Open `index.html` in a browser, or serve the folder:

```bash
python -m http.server 8000
```

Progress ticks, lab lessons, your CAPL code and the theme choice are saved only in your own browser (localStorage).
