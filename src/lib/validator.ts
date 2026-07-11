import Papa from "papaparse";

export type Severity = "ERROR" | "WARNING";

export interface ValidationIssue {
  id: string;
  row: number;
  insetId: string;
  severity: Severity;
  rule: string;
  value: string;
  message: string;
}

export interface ValidationSummary {
  fileName: string;
  totalRows: number;
  issues: ValidationIssue[];
  errorCount: number;
  warningCount: number;
}

export function validateCSV(file: File): Promise<ValidationSummary> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (results) => {
        const data = results.data as Record<string, string>[];
        const issues: ValidationIssue[] = [];
        let errorCount = 0;
        let warningCount = 0;

        data.forEach((row, index) => {
          const rowIndex = index + 2; // Row index in CSV (1-based + 1 for header)

          // 1. Identify columns with case-insensitive / loose matching
          const findValue = (keys: string[]): { val: string; key: string } => {
            for (const key of Object.keys(row)) {
              const normalizedKey = key.trim().toLowerCase().replace(/[\s_-]/g, "");
              for (const searchKey of keys) {
                if (normalizedKey === searchKey.toLowerCase().replace(/[\s_-]/g, "")) {
                  return { val: (row[key] || "").trim(), key };
                }
              }
            }
            return { val: "", key: "" };
          };

          // Find specific fields
          const statusField = findValue(["status"]);
          const cleanedPatchField = findValue(["cleaned_patch_count", "cleanedPatchCount", "cleaned_patch", "cpc"]);
          const patchCountField = findValue(["patch_count", "patchCount", "patch"]);
          const groupDeleteField = findValue(["group_delete_status", "groupDeleteStatus", "group_delete", "gds"]);
          const groupNameField = findValue(["group_name", "groupName", "group"]);
          const insetIdField = findValue(["inset_id", "insetId", "id", "inset", "code"]);

          // Determine insetId to display, fallback to first column or Row number
          let insetId = insetIdField.val;
          if (!insetId) {
            const firstColKey = Object.keys(row)[0];
            if (firstColKey && row[firstColKey]) {
              insetId = `${firstColKey}: ${row[firstColKey]}`;
            } else {
              insetId = `Row ${rowIndex}`;
            }
          }

          // Generate unique issue ID
          const makeIssueId = (ruleName: string) => `${rowIndex}_${ruleName}`;

          // --- RULE 1: Status Code Check ---
          // Requirement: must be exactly "1"
          if (statusField.key) {
            if (statusField.val !== "1") {
              errorCount++;
              issues.push({
                id: makeIssueId("status"),
                row: rowIndex,
                insetId,
                severity: "ERROR",
                rule: "Status Code Check",
                value: statusField.val,
                message: `Status is "${statusField.val}" but must be exactly "1" to denote active campaign.`,
              });
            }
          } else {
            // Missing status column
            errorCount++;
            issues.push({
              id: makeIssueId("status_missing"),
              row: rowIndex,
              insetId,
              severity: "ERROR",
              rule: "Status Code Check",
              value: "MISSING",
              message: "Required 'status' column is missing from the sheet.",
            });
          }

          // --- RULE 2: Patch Count Consistency ---
          if (cleanedPatchField.key || patchCountField.key) {
            const cleanedVal = cleanedPatchField.val;
            const patchVal = patchCountField.val;
            const cleanedNum = Number(cleanedVal);
            const patchNum = Number(patchVal);

            const isCleanedValid = cleanedVal !== "" && !isNaN(cleanedNum);
            const isPatchValid = patchVal !== "" && !isNaN(patchNum);

            if (!isCleanedValid || !isPatchValid) {
              errorCount++;
              issues.push({
                id: makeIssueId("patch_invalid"),
                row: rowIndex,
                insetId,
                severity: "ERROR",
                rule: "Patch Count Consistency",
                value: `cleaned: "${cleanedVal}", total: "${patchVal}"`,
                message: "Patch counts must be valid numeric values.",
              });
            } else {
              // 1. cleaned_patch_count must not be 0
              if (cleanedNum === 0) {
                errorCount++;
                issues.push({
                  id: makeIssueId("patch_zero"),
                  row: rowIndex,
                  insetId,
                  severity: "ERROR",
                  rule: "Patch Count Consistency",
                  value: String(cleanedNum),
                  message: "Cleaned patch count cannot be 0.",
                });
              }
              // 2. cleaned_patch_count cannot be greater than patch_count
              else if (cleanedNum > patchNum) {
                errorCount++;
                issues.push({
                  id: makeIssueId("patch_overflow"),
                  row: rowIndex,
                  insetId,
                  severity: "ERROR",
                  rule: "Patch Count Consistency",
                  value: `cleaned: ${cleanedNum}, total: ${patchNum}`,
                  message: `Cleaned patch count (${cleanedNum}) cannot exceed total patch count (${patchNum}).`,
                });
              }
              // 3. cleaned_patch_count >= 10,000 flags high-volume verification warnings
              else if (cleanedNum >= 10000) {
                warningCount++;
                issues.push({
                  id: makeIssueId("patch_high"),
                  row: rowIndex,
                  insetId,
                  severity: "WARNING",
                  rule: "Patch Count Consistency",
                  value: String(cleanedNum),
                  message: `High-volume patch count warning: Cleaned patch count is unusually high (${cleanedNum}).`,
                });
              }
            }
          } else {
            // Missing patch count columns
            errorCount++;
            issues.push({
              id: makeIssueId("patch_missing"),
              row: rowIndex,
              insetId,
              severity: "ERROR",
              rule: "Patch Count Consistency",
              value: "MISSING",
              message: "Required 'cleaned_patch_count' or 'patch_count' columns are missing.",
            });
          }

          // --- RULE 3: Exhibition Group Deletion Lock ---
          // Requirement: must not be equal to "1"
          if (groupDeleteField.key) {
            if (groupDeleteField.val === "1") {
              errorCount++;
              issues.push({
                id: makeIssueId("group_delete"),
                row: rowIndex,
                insetId,
                severity: "ERROR",
                rule: "Exhibition Group Deletion Lock",
                value: groupDeleteField.val,
                message: "Exhibition group is locked/queued for deletion (group_delete_status = 1).",
              });
            }
          }

          // --- RULE 4: Group Name Cleanliness ---
          if (groupNameField.key) {
            const name = groupNameField.val;
            
            // Find all characters that are NOT alphanumeric, space, underscore, or dash
            const disallowedRegex = /[^a-zA-Z0-9_ -]/g;
            const matches = name.match(disallowedRegex);

            if (matches) {
              const uniqueMatches = Array.from(new Set(matches));
              
              // Separate into non-ASCII and standard special characters
              const nonAsciiMatches = uniqueMatches.filter(c => /[^\x00-\x7F]/.test(c));
              const specialMatches = uniqueMatches.filter(c => /[\x00-\x7F]/.test(c));
              
              const displayChar = (c: string) => c === " " ? '"space"' : `"${c}"`;

              if (nonAsciiMatches.length > 0) {
                const charsDisplay = nonAsciiMatches.map(displayChar).join(", ");
                const charWord = nonAsciiMatches.length > 1 ? "characters" : "character";
                errorCount++;
                issues.push({
                  id: makeIssueId("group_name_unicode"),
                  row: rowIndex,
                  insetId,
                  severity: "ERROR",
                  rule: "Group Name Cleanliness",
                  value: name,
                  message: `Group name contains disallowed non-ASCII ${charWord} or emoji: ${charsDisplay}`,
                });
              } else if (specialMatches.length > 0) {
                const charsDisplay = specialMatches.map(displayChar).join(", ");
                const charWord = specialMatches.length > 1 ? "characters" : "character";
                errorCount++;
                issues.push({
                  id: makeIssueId("group_name_chars"),
                  row: rowIndex,
                  insetId,
                  severity: "ERROR",
                  rule: "Group Name Cleanliness",
                  value: name,
                  message: `Group name contains the disallowed special ${charWord}: ${charsDisplay}`,
                });
              }
            }
          }
        });

        resolve({
          fileName: file.name,
          totalRows: data.length,
          issues,
          errorCount,
          warningCount,
        });
      },
      error: (error) => {
        reject(error);
      },
    });
  });
}
