// Runtime checks for the CSV validation engine. Run with `bun run test`.
// Exercises the real Papa.parse -> validateRows path used by the app.
import Papa from "papaparse";
import { validateRows } from "../src/lib/validator";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

function run(csv: string) {
  const { data } = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: false });
  return validateRows(data as Record<string, string>[], "test.csv");
}
const rules = (s: ReturnType<typeof run>) => s.issues.map((i) => `${i.row}:${i.rule}`);

console.log("\n[1] Happy path + Others appended form");
{
  const s = run(
`group_name,status,cleaned_patch_count,patch_count,group_delete_status,inset_id
Fruit Juice - Others,1,250,300,0,INS001
Water,1,10,20,0,INS002`);
  check("no errors", s.errorCount === 0, JSON.stringify(rules(s)));
  check("2 rows", s.totalRows === 2);
  check("health 100%", s.healthPct === 100);
  check("passingRows 2", s.passingRows === 2);
}

console.log("\n[2] Missing Others group -> sheet-level error");
{
  const s = run(
`group_name,status,cleaned_patch_count,patch_count
Water,1,10,20`);
  check("has sheet Others error", s.issues.some((i) => i.row === 0 && i.rule === "Required Others Group"));
  check("errorCount 1", s.errorCount === 1, JSON.stringify(rules(s)));
  check("sheet error doesn't drop passingRows", s.passingRows === 1 && s.errorRows === 0);
}

console.log("\n[3] Case/word-boundary sensitivity of the Others check");
{
  const s = run(
`group_name,status,cleaned_patch_count,patch_count
others,1,10,20
AnOthers,1,10,20
Others1,1,10,20`);
  check("lowercase/substring do NOT satisfy", s.issues.some((i) => i.rule === "Required Others Group"), JSON.stringify(rules(s)));
}
{
  const s = run(
`group_name,status,cleaned_patch_count,patch_count
Snacks - Others,1,10,20`);
  check("'Snacks - Others' satisfies", !s.issues.some((i) => i.rule === "Required Others Group"));
}

console.log("\n[4] Emoji counts as ONE char (u-flag fix)");
{
  const s = run(
`group_name,status,cleaned_patch_count,patch_count
Main_Hall_\u{1F525} - Others,1,10,20`);
  const emojiIssue = s.issues.find((i) => i.rule === "Group Name Cleanliness");
  check("emoji flagged", !!emojiIssue, JSON.stringify(rules(s)));
  check("message says 'character' (singular)", !!emojiIssue && /non-ASCII character/.test(emojiIssue.message), emojiIssue?.message);
  check("not split into surrogate halves", !!emojiIssue && !/characters/.test(emojiIssue.message));
}

console.log("\n[5] Row-number accuracy with a blank line in the middle");
{
  const s = run(
`group_name,status,cleaned_patch_count,patch_count
Alpha - Others,1,10,20

Beta,2,10,20`);
  check("2 data rows (blank skipped)", s.totalRows === 2, `totalRows=${s.totalRows}`);
  check("Beta status error reported at file line 4", s.issues.some((i) => i.row === 4 && i.rule === "Status Code Check"), JSON.stringify(rules(s)));
}

console.log("\n[6] Multi-error row: metrics stay non-negative");
{
  const s = run(
`group_name,status,cleaned_patch_count,patch_count,group_delete_status
Others,2,0,5,1`);
  check("errorCount 3", s.errorCount === 3, JSON.stringify(rules(s)));
  check("errorRows 1 (distinct)", s.errorRows === 1);
  check("passingRows 0 not negative", s.passingRows === 0);
  check("healthPct 0", s.healthPct === 0);
}

console.log("\n[7] Empty sheet: no NaN");
{
  const s = run(`group_name,status,cleaned_patch_count,patch_count`);
  check("totalRows 0", s.totalRows === 0);
  check("healthPct is 0 not NaN", s.healthPct === 0 && !Number.isNaN(s.healthPct));
}

console.log("\n[8] Cleaned > total, and high-volume warning");
{
  const s = run(
`group_name,status,cleaned_patch_count,patch_count
Alpha - Others,1,350,300
Beta - x,1,15000,20000`);
  check("overflow error on row 2", s.issues.some((i) => i.row === 2 && /cannot exceed/.test(i.message)));
  check("high-volume WARNING on row 3", s.issues.some((i) => i.row === 3 && i.severity === "WARNING"));
  check("warningCount 1", s.warningCount === 1);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
