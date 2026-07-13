import Papa from "papaparse";

export type Severity = "ERROR" | "WARNING";

export interface ValidationIssue {
  id: string;
  row: number; // 0 = sheet-level issue (not tied to a single row)
  insetId: string;
  severity: Severity;
  rule: string;
  value: string;
  message: string;
}

export interface OthersMatch {
  row: number; // file line where the Others group was found
  value: string; // the group_name value
  exact: boolean; // true when the value is exactly "Others", false when appended
}

export interface ValidationSummary {
  fileName: string;
  totalRows: number;
  issues: ValidationIssue[];
  errorCount: number; // total ERROR issues (a row may contribute several)
  warningCount: number; // total WARNING issues
  errorRows: number; // distinct data rows with at least one ERROR
  passingRows: number; // totalRows - errorRows (never negative)
  healthPct: number; // passingRows / totalRows, 0 when there are no rows
  othersMatches: OthersMatch[]; // rows whose group_name contains the word "Others"
}

// Field aliases matched loosely (case-insensitive, punctuation-insensitive).
const FIELD_ALIASES = {
  status: ["status"],
  cleanedPatch: ["cleaned_patch_count", "cleanedPatchCount", "cleaned_patch", "cpc"],
  patchCount: ["patch_count", "patchCount", "patch"],
  groupDelete: ["group_delete_status", "groupDeleteStatus", "group_delete", "gds"],
  groupName: ["group_name", "groupName", "group"],
  insetId: ["inset_id", "insetId", "id", "inset", "code"],
} as const;

const normalizeKey = (k: string) => k.trim().toLowerCase().replace(/[\s_-]/g, "");

// "Others" must appear as a standalone, exactly-cased word: "Others" or
// "Fruit Juice - Others". "others", "OTHERS", "AnOthers", "Others1" do not count.
const OTHERS_REGEX = /\bOthers\b/;

const isRowEmpty = (row: Record<string, string>) =>
  Object.values(row).every((v) => (v ?? "").trim() === "");

export function validateCSV(file: File): Promise<ValidationSummary> {
  return new Promise((resolve, reject) => {
    // skipEmptyLines is intentionally OFF so that a row's array index maps
    // directly to its line in the file (header = line 1, data starts at line 2);
    // blank rows are skipped manually below without shifting reported row numbers.
    Papa.parse(file, {
      header: true,
      skipEmptyLines: false,
      complete: (results) => {
        resolve(validateRows(results.data as Record<string, string>[], file.name));
      },
      error: (error) => reject(error),
    });
  });
}

// Pure validation over already-parsed rows. `data` must include blank rows
// (row array index maps to file line: header = line 1, data starts at line 2).
export function validateRows(data: Record<string, string>[], fileName: string): ValidationSummary {
        const issues: ValidationIssue[] = [];
        const errorRowSet = new Set<number>();
        let errorCount = 0;
        let warningCount = 0;
        let totalRows = 0;

        // Sheet-level tracking for the "Others" requirement.
        let groupNameColumnSeen = false;
        const othersMatches: OthersMatch[] = [];

        data.forEach((row, index) => {
          if (isRowEmpty(row)) return;
          totalRows++;

          const rowIndex = index + 2; // header is line 1

          const findValue = (aliases: readonly string[]): { val: string; key: string } => {
            for (const key of Object.keys(row)) {
              const nk = normalizeKey(key);
              for (const alias of aliases) {
                if (nk === normalizeKey(alias)) {
                  return { val: (row[key] || "").trim(), key };
                }
              }
            }
            return { val: "", key: "" };
          };

          const statusField = findValue(FIELD_ALIASES.status);
          const cleanedPatchField = findValue(FIELD_ALIASES.cleanedPatch);
          const patchCountField = findValue(FIELD_ALIASES.patchCount);
          const groupDeleteField = findValue(FIELD_ALIASES.groupDelete);
          const groupNameField = findValue(FIELD_ALIASES.groupName);
          const insetIdField = findValue(FIELD_ALIASES.insetId);

          // Display label for the row, falling back to the first column value.
          let insetId = insetIdField.val;
          if (!insetId) {
            const firstColKey = Object.keys(row)[0];
            insetId = firstColKey && row[firstColKey] ? `${firstColKey}: ${row[firstColKey]}` : `Row ${rowIndex}`;
          }

          const addIssue = (
            ruleName: string,
            severity: Severity,
            value: string,
            message: string,
            idSuffix: string
          ) => {
            if (severity === "ERROR") {
              errorCount++;
              errorRowSet.add(rowIndex);
            } else {
              warningCount++;
            }
            issues.push({
              id: `${rowIndex}_${idSuffix}`,
              row: rowIndex,
              insetId,
              severity,
              rule: ruleName,
              value,
              message,
            });
          };

          // --- RULE 1: Status Code Check — must be exactly "1" ---
          if (statusField.key) {
            if (statusField.val !== "1") {
              addIssue(
                "Status Code Check",
                "ERROR",
                statusField.val,
                `Status is "${statusField.val}" but must be exactly "1" to denote active campaign.`,
                "status"
              );
            }
          } else {
            addIssue("Status Code Check", "ERROR", "MISSING", "Required 'status' column is missing from the sheet.", "status_missing");
          }

          // --- RULE 2: Patch Count Consistency ---
          if (cleanedPatchField.key && patchCountField.key) {
            const cleanedVal = cleanedPatchField.val;
            const patchVal = patchCountField.val;
            const cleanedNum = Number(cleanedVal);
            const patchNum = Number(patchVal);
            const isCleanedValid = cleanedVal !== "" && !isNaN(cleanedNum);
            const isPatchValid = patchVal !== "" && !isNaN(patchNum);

            if (!isCleanedValid || !isPatchValid) {
              addIssue(
                "Patch Count Consistency",
                "ERROR",
                `cleaned: "${cleanedVal}", total: "${patchVal}"`,
                "Patch counts must be valid numeric values.",
                "patch_invalid"
              );
            } else if (cleanedNum === 0) {
              addIssue("Patch Count Consistency", "ERROR", String(cleanedNum), "Cleaned patch count cannot be 0.", "patch_zero");
            } else if (cleanedNum > patchNum) {
              addIssue(
                "Patch Count Consistency",
                "ERROR",
                `cleaned: ${cleanedNum}, total: ${patchNum}`,
                `Cleaned patch count (${cleanedNum}) cannot exceed total patch count (${patchNum}).`,
                "patch_overflow"
              );
            } else if (cleanedNum >= 10000) {
              addIssue(
                "Patch Count Consistency",
                "WARNING",
                String(cleanedNum),
                `High-volume patch count warning: Cleaned patch count is unusually high (${cleanedNum}).`,
                "patch_high"
              );
            }
          } else {
            // At least one of the two required columns is absent.
            const present = cleanedPatchField.key || patchCountField.key;
            addIssue(
              "Patch Count Consistency",
              "ERROR",
              "MISSING",
              present
                ? "Both 'cleaned_patch_count' and 'patch_count' columns are required; one is missing."
                : "Required 'cleaned_patch_count' and 'patch_count' columns are missing.",
              "patch_missing"
            );
          }

          // --- RULE 3: Exhibition Group Deletion Lock — must not equal "1" ---
          if (groupDeleteField.key && groupDeleteField.val === "1") {
            addIssue(
              "Exhibition Group Deletion Lock",
              "ERROR",
              groupDeleteField.val,
              "Exhibition group is locked/queued for deletion (group_delete_status = 1).",
              "group_delete"
            );
          }

          // --- RULE 4: Group Name Cleanliness ---
          if (groupNameField.key) {
            groupNameColumnSeen = true;
            const name = groupNameField.val;

            // Record every group whose name contains the word "Others" (bare
            // "Others" or appended, e.g. "Fruit Juice - Others"). These are shown
            // as a positive result above the issues table, not as issues.
            if (OTHERS_REGEX.test(name)) {
              othersMatches.push({ row: rowIndex, value: name, exact: name === "Others" });
            }

            // Match by Unicode code point (the `u` flag keeps emoji/astral
            // characters intact instead of splitting them into surrogate halves).
            const disallowed = name.match(/[^a-zA-Z0-9_ -]/gu);
            if (disallowed) {
              const unique = Array.from(new Set(disallowed));
              const nonAscii = unique.filter((c) => /[^\x00-\x7F]/u.test(c));
              const special = unique.filter((c) => /^[\x00-\x7F]$/.test(c));
              const displayChar = (c: string) => (c === " " ? '"space"' : `"${c}"`);

              if (nonAscii.length > 0) {
                const word = nonAscii.length > 1 ? "characters" : "character";
                addIssue(
                  "Group Name Cleanliness",
                  "ERROR",
                  name,
                  `Group name contains disallowed non-ASCII ${word} or emoji: ${nonAscii.map(displayChar).join(", ")}`,
                  "group_name_unicode"
                );
              } else if (special.length > 0) {
                const word = special.length > 1 ? "characters" : "character";
                addIssue(
                  "Group Name Cleanliness",
                  "ERROR",
                  name,
                  `Group name contains the disallowed special ${word}: ${special.map(displayChar).join(", ")}`,
                  "group_name_chars"
                );
              }
            }
          }
        });

        // --- RULE 5 (sheet-level): Required "Others" Group ---
        // At least one group_name must contain the exactly-cased word "Others".
        // When found, no issue is raised — the matches are surfaced positively via
        // summary.othersMatches. Only the absence is an error.
        if (groupNameColumnSeen) {
          if (othersMatches.length === 0) {
            errorCount++;
            issues.unshift({
              id: "sheet_others_missing",
              row: 0,
              insetId: "— Sheet-wide —",
              severity: "ERROR",
              rule: "Required Others Group",
              value: "not found",
              message:
                'At least one group must contain the word "Others" (exact casing), e.g. "Others" or "Fruit Juice - Others". None was found.',
            });
          }
        } else if (totalRows > 0) {
          errorCount++;
          issues.unshift({
            id: "sheet_others_no_column",
            row: 0,
            insetId: "— Sheet-wide —",
            severity: "ERROR",
            rule: "Required Others Group",
            value: "no group_name column",
            message: 'No \'group_name\' column found, so the required "Others" group cannot be verified.',
          });
        }

        const errorRows = errorRowSet.size;
        const passingRows = Math.max(0, totalRows - errorRows);
        const healthPct = totalRows === 0 ? 0 : Math.round((passingRows / totalRows) * 100);

        return {
          fileName,
          totalRows,
          issues,
          errorCount,
          warningCount,
          errorRows,
          passingRows,
          healthPct,
          othersMatches,
        };
}
