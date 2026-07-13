"use client";

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  Upload, AlertCircle, CheckCircle2, X, Download, Trash2,
  Check, FileSpreadsheet, Search, BookOpen,
  AlertTriangle, ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { validateCSV, ValidationSummary, Severity } from '@/lib/validator';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface RuleDetail {
  id: string;
  name: string;
  field: string;
  severity: Severity;
  description: string;
  logic: string;
  examplePass: string;
  exampleFail: string;
}

const VALIDATION_RULES: RuleDetail[] = [
  {
    id: 'status',
    name: 'Status Code Check',
    field: 'status',
    severity: 'ERROR',
    description: 'Verifies that the exhibition entry is active and verified.',
    logic: 'Must be exactly equal to "1". Code "1" denotes active status. Other status codes represent drafts, inactive entries, or archived records.',
    examplePass: 'status: "1"',
    exampleFail: 'status: "0" or "2" or ""'
  },
  {
    id: 'patch-count',
    name: 'Patch Count Consistency',
    field: 'cleaned_patch_count, patch_count',
    severity: 'ERROR',
    description: 'Ensures cleaned patch numbers are mathematically valid, non-zero, and bounded by total patches.',
    logic: '1. cleaned_patch_count must not be 0.\n2. cleaned_patch_count cannot be greater than patch_count.\n3. (WARNING) cleaned_patch_count >= 10,000 flags high-volume verification warnings.',
    examplePass: 'cleaned_patch_count: "250", patch_count: "300"',
    exampleFail: 'cleaned_patch_count: "350", patch_count: "300" (ERROR) or cleaned_patch_count: "0" (ERROR)'
  },
  {
    id: 'group-delete',
    name: 'Exhibition Group Deletion Lock',
    field: 'group_delete_status',
    severity: 'ERROR',
    description: 'Ensures the exhibition group is not flagged as queued for deletion.',
    logic: 'Must not be equal to "1". A value of "1" prevents proper rendering of the exhibition display on clients.',
    examplePass: 'group_delete_status: "0" or ""',
    exampleFail: 'group_delete_status: "1"'
  },
  {
    id: 'group-name',
    name: 'Group Name Cleanliness',
    field: 'group_name',
    severity: 'ERROR',
    description: 'Checks for compatible alphanumeric schema. Flags special characters, emojis, and non-ASCII glyphs.',
    logic: '1. Only alphanumeric characters, spaces, dashes "-", and underscores "_" are allowed. All other special characters are disallowed.\n2. No non-ASCII characters (UTF-8 code points above 127).\n3. No emojis, stickers, or high-plane unicode symbols.',
    examplePass: 'group_name: "Exhibition-Hall-A" or "Phaner Pie"',
    exampleFail: 'group_name: "Hall%North" (disallowed chars) or "Main_Hall_🔥" (sticker/emoji)'
  },
  {
    id: 'others',
    name: 'Required Others Group',
    field: 'group_name (sheet-wide)',
    severity: 'ERROR',
    description: 'Ensures the sheet contains at least one catch-all "Others" group.',
    logic: 'Across all rows, at least one group_name must contain the exactly-cased word "Others". It may stand alone ("Others") or be appended to a category ("Fruit Juice - Others"). Lowercase "others" or "OTHERS" do not qualify. When found, the matching rows are highlighted above the report; only the absence is flagged as an error.',
    examplePass: 'group_name: "Others" or "Fruit Juice - Others" (present in ≥1 row)',
    exampleFail: 'No row has a group_name containing the word "Others"'
  }
];

// Pristine custom Button component to avoid heroui typing compilation bugs
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isDisabled?: boolean;
  onPress?: () => void;
  startContent?: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({
  children,
  variant = 'primary',
  size = 'md',
  isDisabled,
  onPress,
  className,
  startContent,
  ...props
}, ref) => {
  const baseStyle = "inline-flex items-center justify-center font-bold transition-all duration-200 select-none outline-none active:scale-[0.98] disabled:opacity-45 disabled:pointer-events-none";
  
  const variants = {
    primary: "bg-primary text-white hover:bg-primary/95 shadow-sm border border-transparent",
    secondary: "bg-[#1b1d22] text-white hover:bg-zinc-800 shadow-sm border border-transparent",
    outline: "border border-border-main bg-surface text-text-primary hover:bg-background shadow-xs",
    ghost: "bg-transparent text-text-primary hover:bg-zinc-100",
  };

  const sizes = {
    sm: "px-3 py-1.5 text-xs rounded-full gap-1.5",
    md: "px-5 py-2.5 text-xs rounded-full gap-2",
    lg: "px-6 py-3.5 text-sm rounded-full gap-2.5",
  };

  return (
    <button
      ref={ref}
      onClick={onPress || props.onClick}
      disabled={isDisabled}
      className={cn(
        baseStyle,
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {startContent}
      {children}
    </button>
  );
});
Button.displayName = 'Button';

export default function ValidatorDashboard() {
  const [summary, setSummary] = useState<ValidationSummary | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'ERROR' | 'WARNING'>('ALL');
  const [selectedRuleFilter, setSelectedRuleFilter] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  
  // Custom Drawer overlay state
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Expanded rule accordion state
  const [expandedRule, setExpandedRule] = useState<string | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Close the reference drawer on Escape.
  useEffect(() => {
    if (!isDrawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDrawerOpen]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    
    setIsProcessing(true);
    try {
      const result = await validateCSV(acceptedFiles[0]);
      setSummary(result);
      setSelectedIds(new Set(result.issues.map(i => i.id)));
      setCurrentPage(1);
    } catch (error) {
      console.error('Parsing failed:', error);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    // Windows/Excel often report .csv as vnd.ms-excel or an empty MIME type, so
    // accept those and plain text too — all keyed to the .csv extension.
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.ms-excel': ['.csv'],
      'text/plain': ['.csv'],
      'application/csv': ['.csv'],
    },
    multiple: false
  });

  const filteredIssues = useMemo(() => {
    if (!summary) return [];
    return summary.issues.filter(issue => {
      // Severity Filter
      const matchesSeverity = filter === 'ALL' || issue.severity === filter;
      
      // Rule-type Filter
      let matchesRule = true;
      if (selectedRuleFilter) {
        matchesRule = issue.rule.toLowerCase().includes(selectedRuleFilter.toLowerCase());
      }

      // Search Query
      const matchesSearch = searchQuery.trim() === '' || 
        issue.insetId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        issue.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
        issue.rule.toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(issue.row).includes(searchQuery);

      return matchesSeverity && matchesRule && matchesSearch;
    });
  }, [summary, filter, selectedRuleFilter, searchQuery]);

  // Paginated issues
  const paginatedIssues = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredIssues.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredIssues, currentPage]);

  const totalPages = Math.max(1, Math.ceil(filteredIssues.length / itemsPerPage));

  // Count matches per rule layer. "Required Others Group" is matched by 'others'
  // and must not fall into the name bucket, so name uses 'cleanliness'/'char'.
  const ruleCounts = useMemo(() => {
    if (!summary) return { status: 0, patch: 0, delete: 0, name: 0, others: 0 };
    return {
      status: summary.issues.filter(i => i.rule.toLowerCase().includes('status')).length,
      patch: summary.issues.filter(i => i.rule.toLowerCase().includes('patch') || i.rule.toLowerCase().includes('cpc')).length,
      delete: summary.issues.filter(i => i.rule.toLowerCase().includes('delete') || i.rule.toLowerCase().includes('gds')).length,
      name: summary.issues.filter(i => i.rule.toLowerCase().includes('cleanliness') || i.rule.toLowerCase().includes('char')).length,
      others: summary.issues.filter(i => i.rule.toLowerCase().includes('others')).length,
    };
  }, [summary]);

  const toggleSelection = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleAll = () => {
    const visibleIds = filteredIssues.map(i => i.id);
    const allVisibleSelected = visibleIds.every(id => selectedIds.has(id));
    
    const next = new Set(selectedIds);
    if (allVisibleSelected) {
      visibleIds.forEach(id => next.delete(id));
    } else {
      visibleIds.forEach(id => next.add(id));
    }
    setSelectedIds(next);
  };

  // RFC 4180 cell escaping: wrap in quotes and double any embedded quotes when
  // the value contains a comma, quote or newline. Prevents malformed exports for
  // values with special characters (which the validator specifically flags).
  const csvCell = (value: string | number) => {
    const s = String(value ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const exportSelected = () => {
    if (!summary) return;
    const selectedIssues = summary.issues.filter(i => selectedIds.has(i.id));
    if (selectedIssues.length === 0) return;

    const csvContent = [
      ['Row', 'Inset ID', 'Severity', 'Rule', 'Current Value', 'Message'],
      ...selectedIssues.map(i => [
        i.row === 0 ? 'SHEET' : i.row,
        i.insetId,
        i.severity,
        i.rule,
        i.value,
        i.message,
      ]),
    ].map(row => row.map(csvCell).join(',')).join('\r\n');

    // BOM so Excel opens UTF-8 group names correctly.
    const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = summary.fileName.replace(/\.csv$/i, '');
    a.download = `validation_report_${safeName}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const activeIssueCount = selectedIds.size;

  return (
    <div className="min-h-screen bg-background text-text-primary font-sans flex flex-col relative overflow-x-hidden selection:bg-primary-container selection:text-on-primary-container">
      
      {/* Dynamic Header */}
      <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur-md border-b border-border-main px-6 py-4 shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3.5">
            {/* Google colored dot group */}
            <div className="flex -space-x-1 p-2 bg-background rounded-full border border-border-main shadow-inner">
              <span className="w-3.5 h-3.5 rounded-full bg-[#1a73e8]" />
              <span className="w-3.5 h-3.5 rounded-full bg-[#ea4335]" />
              <span className="w-3.5 h-3.5 rounded-full bg-[#fbbc05]" />
              <span className="w-3.5 h-3.5 rounded-full bg-[#34a853]" />
            </div>
            <div>
              <span className="font-bold text-lg tracking-tight block text-primary">ParallelDots</span>
              <span className="text-[11px] text-text-secondary block -mt-1 font-semibold font-mono uppercase tracking-widest">inset sheet validator</span>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <Button
              onPress={() => setIsDrawerOpen(true)}
              variant="secondary"
              startContent={<BookOpen className="w-4 h-4" />}
              className="font-bold text-xs rounded-full"
            >
              Diagnostic Checklist
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content Workspace */}
      <main className="relative flex-1 max-w-7xl w-full mx-auto px-6 py-8 flex flex-col justify-start">
        
        {/* Workspace Header */}
        <div className="mb-8">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-primary-container text-on-primary-container border border-border-main text-xs font-bold mb-3 shadow-xs"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span>Active Diagnostics Mode v3.5</span>
          </motion.div>
          <motion.h1 
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="text-3xl md:text-4xl font-black tracking-tight text-text-primary"
          >
            Inset Sheet Validator
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mt-2 text-sm text-text-secondary max-w-2xl leading-relaxed font-semibold"
          >
            Import inset sheet CSV and perform automated checklist validations to ensure campaign compliance.
          </motion.p>
        </div>

        <AnimatePresence mode="wait">
          {!summary ? (
            <motion.div
              key="landing-workspace"
              initial={{ opacity: 0, scale: 0.99 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.99 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start"
            >
              {/* Left Column: Material Drag-and-Drop Ingestion Card */}
              <div className="lg:col-span-7 space-y-6">
                <div
                  {...getRootProps()}
                  className={cn(
                    "relative group cursor-pointer overflow-hidden rounded-[32px] border-2 border-dashed transition-all duration-300 min-h-[380px] flex flex-col justify-center items-center p-8 bg-surface border-border-main hover:border-primary hover:shadow-md shadow-xs",
                    isDragActive && "border-primary bg-primary-container/30 scale-[1.01]"
                  )}
                >
                  <input {...getInputProps()} />
                  
                  <div className="flex flex-col items-center justify-center text-center space-y-6">
                    <div className={cn(
                      "p-6 rounded-full bg-background border border-border-main transition-all duration-500 shadow-sm flex items-center justify-center",
                      isDragActive ? "scale-110 border-primary bg-primary-container text-primary" : "group-hover:scale-105"
                    )}>
                      <Upload className="w-10 h-10 text-primary" />
                    </div>
                    <div className="space-y-2">
                      <p className="text-xl font-extrabold tracking-tight text-text-primary">
                        {isProcessing ? "Analyzing Data Structures..." : "Import Exhibition CSV"}
                      </p>
                      <p className="text-xs text-text-secondary max-w-sm mx-auto font-bold leading-relaxed">
                        Drag & drop your campaign <span className="font-mono text-primary bg-primary-container px-1.5 py-0.5 rounded font-black border border-border-main">.csv</span> sheet, or click to choose from local disk.
                      </p>
                    </div>
                  </div>

                  {/* Corner Accent Decor */}
                  <div className="absolute top-4 right-4 h-2.5 w-2.5 rounded-full bg-border-main group-hover:bg-primary transition-colors" />
                </div>
              </div>

              {/* Right Column: Material Accordion Rules Checklist */}
              <div className="lg:col-span-5 space-y-6">
                <div className="p-6 rounded-[32px] border border-border-main bg-surface space-y-5 shadow-sm">
                  <div>
                    <h2 className="text-xs font-black uppercase tracking-widest text-text-secondary">System Integrity Checklist</h2>
                    <p className="text-xs text-text-primary font-bold mt-1">Our engine checks 5 distinct logic verification layers:</p>
                  </div>

                  <div className="space-y-3">
                    {VALIDATION_RULES.map((rule, idx) => {
                      const isExpanded = expandedRule === rule.id;
                      return (
                        <div 
                          key={rule.id}
                          className="bg-surface border border-border-main rounded-2xl overflow-hidden transition-colors"
                        >
                          <button
                            onClick={() => setExpandedRule(isExpanded ? null : rule.id)}
                            className="w-full flex items-center justify-between py-3.5 px-4 text-left font-bold text-xs select-none outline-none hover:bg-zinc-50 transition-colors"
                          >
                            <div className="flex items-center space-x-2.5">
                              <span className="text-[10px] font-mono text-primary bg-primary-container px-2 py-0.5 rounded-full font-bold border border-border-main">0{idx+1}</span>
                              <span className="text-xs font-bold text-text-primary">{rule.name}</span>
                            </div>
                            <div className="flex items-center space-x-2.5">
                              <span className="px-2 py-0.5 text-[9px] font-extrabold rounded-full bg-error-container text-error-main border border-error-main/10">
                                {rule.severity}
                              </span>
                              <ChevronDown className={cn("w-4 h-4 text-text-secondary transition-transform duration-200", isExpanded && "transform rotate-180")} />
                            </div>
                          </button>
                          
                          <AnimatePresence initial={false}>
                            {isExpanded && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2 }}
                              >
                                <div className="px-4 pb-4 pt-1 text-xs space-y-3 font-semibold border-t border-border-main/50 bg-background/50">
                                  <div>
                                    <span className="text-[10px] text-text-secondary uppercase font-bold block">Summary Requirement</span>
                                    <p className="text-text-primary leading-relaxed mt-0.5">{rule.description}</p>
                                  </div>
                                  <div>
                                    <span className="text-[10px] text-text-secondary uppercase font-bold block">Logic Evaluator</span>
                                    <p className="font-mono text-[10px] text-text-primary leading-relaxed whitespace-pre-line mt-1 bg-background p-2.5 rounded-xl border border-border-main">{rule.logic}</p>
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-2">
                                    <div className="p-2.5 rounded-xl bg-success-container border border-success-main/15">
                                      <span className="text-[9px] text-success-main font-bold block">Expected Pass</span>
                                      <code className="font-mono text-[10px] block mt-1 text-success-main truncate">{rule.examplePass}</code>
                                    </div>
                                    <div className="p-2.5 rounded-xl bg-error-container border border-error-main/15">
                                      <span className="text-[9px] text-error-main font-bold block">Will Reject</span>
                                      <code className="font-mono text-[10px] block mt-1 text-error-main truncate">{rule.exampleFail}</code>
                                    </div>
                                  </div>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>

                  <div className="text-center text-[11px] text-text-secondary font-black pt-2">
                    💡 Click any checklist layer card above to expand details & formats
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            // Results & Validation Report View (Google Material style list & grid)
            <motion.div
              key="diagnostic-results"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8 pb-32"
            >
              {/* Report Header Info card */}
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-6 bg-surface border border-border-main rounded-[28px] shadow-sm">
                <div className="flex items-center space-x-4">
                  <div className="h-12 w-12 rounded-full bg-primary-container text-primary flex items-center justify-center shadow-sm border border-border-main">
                    <FileSpreadsheet className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black tracking-tight text-text-primary truncate max-w-xs md:max-w-md">{summary.fileName}</h2>
                    <span className="text-xs text-text-secondary font-bold flex items-center space-x-1.5 mt-0.5">
                      <span>{summary.totalRows} records evaluated</span>
                      <span>•</span>
                      <span>{summary.issues.length} active violations detected</span>
                    </span>
                  </div>
                </div>

                <div className="flex items-center space-x-2 w-full md:w-auto">
                  <Button
                    onPress={() => {
                      setSummary(null);
                      setSelectedRuleFilter(null);
                    }}
                    variant="outline"
                    className="font-black text-xs text-primary border-border-main hover:bg-background bg-surface w-full md:w-auto shadow-xs rounded-full flex items-center justify-center gap-2"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Start Over</span>
                  </Button>
                </div>
              </div>

              {/* Material Bento Metrics Dashboard Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                
                {/* Health Index Card */}
                <div className="p-6 rounded-[24px] bg-surface border border-border-main flex flex-col justify-between shadow-sm hover:shadow-md transition-all">
                  <div className="flex justify-between items-start">
                    <span className="text-[11px] font-black text-text-secondary uppercase tracking-wider">Health Index</span>
                    <CheckCircle2 className="w-5 h-5 text-success-main" />
                  </div>
                  <div className="mt-4 flex items-end justify-between">
                    <div>
                      <p className={cn(
                        "text-3xl font-black tracking-tight",
                        summary.healthPct >= 100 ? "text-success-main" : summary.healthPct >= 75 ? "text-warning-main" : "text-error-main"
                      )}>
                        {summary.healthPct}%
                      </p>
                      <span className="text-[10px] text-text-secondary font-bold">Row Passing Ratio</span>
                    </div>
                    {/* Linear health line */}
                    <div className="w-20 bg-background h-2 rounded-full overflow-hidden border border-border-main">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          summary.healthPct >= 100 ? "bg-success-main" : "bg-error-main"
                        )}
                        style={{ width: `${summary.healthPct}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Error Card */}
                <div className="p-6 rounded-[24px] bg-error-container border border-error-main/15 flex flex-col justify-between shadow-sm hover:shadow-md transition-all">
                  <div className="flex justify-between items-start">
                    <span className="text-[11px] font-black text-on-error-container uppercase tracking-wider">Critical Errors</span>
                    <AlertCircle className={cn("w-5 h-5", summary.errorCount > 0 ? "text-error-main animate-pulse" : "text-text-secondary")} />
                  </div>
                  <div className="mt-4">
                    <p className="text-3xl font-black tracking-tight text-error-main">{summary.errorCount}</p>
                    <span className="text-[10px] text-on-error-container font-bold">Requires Immediate Rectification</span>
                  </div>
                </div>

                {/* Warnings Card */}
                <div className="p-6 rounded-[24px] bg-surface border border-border-main flex flex-col justify-between shadow-sm hover:shadow-md transition-all">
                  <div className="flex justify-between items-start">
                    <span className="text-[11px] font-black text-text-secondary uppercase tracking-wider">Warnings</span>
                    <AlertTriangle className={cn("w-5 h-5", summary.warningCount > 0 ? "text-warning-main" : "text-text-secondary")} />
                  </div>
                  <div className="mt-4">
                    <p className="text-3xl font-black tracking-tight text-warning-main">{summary.warningCount}</p>
                    <span className="text-[10px] text-text-secondary font-bold">Extreme Parameters Flagged</span>
                  </div>
                </div>

                {/* Total Compliance Rate Card */}
                <div className="p-6 rounded-[24px] bg-surface border border-border-main flex flex-col justify-between shadow-sm hover:shadow-md transition-all">
                  <div className="flex justify-between items-start">
                    <span className="text-[11px] font-black text-text-secondary uppercase tracking-wider">Inbound Compliance</span>
                    <Check className="w-5 h-5 text-success-main" />
                  </div>
                  <div className="mt-4">
                    <p className="text-3xl font-black tracking-tight text-text-primary">
                      {summary.passingRows} <span className="text-sm text-text-secondary font-extrabold">/ {summary.totalRows}</span>
                    </p>
                    <span className="text-[10px] text-text-secondary font-bold">Rows Ready for Campaign Ingestion</span>
                  </div>
                </div>
              </div>

              {/* Material Chips Filter Segment bar */}
              <div className="bg-surface border border-border-main rounded-[28px] p-5 space-y-4 shadow-sm">
                <span className="text-[11px] font-black text-text-secondary uppercase tracking-widest block">Filter Diagnostics by Layer</span>
                <div className="flex flex-wrap gap-2.5">
                  <Button
                    size="sm"
                    onPress={() => {
                      setSelectedRuleFilter(null);
                      setCurrentPage(1);
                    }}
                    variant={selectedRuleFilter === null ? 'primary' : 'outline'}
                    className="font-extrabold text-xs rounded-full"
                  >
                    All Check layers ({summary.issues.length})
                  </Button>

                  <Button
                    size="sm"
                    onPress={() => {
                      setSelectedRuleFilter('status');
                      setCurrentPage(1);
                    }}
                    variant={selectedRuleFilter === 'status' ? 'primary' : 'outline'}
                    className="font-extrabold text-xs rounded-full flex items-center gap-1.5"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                    <span>Status ({ruleCounts.status})</span>
                  </Button>

                  <Button
                    size="sm"
                    onPress={() => {
                      setSelectedRuleFilter('patch');
                      setCurrentPage(1);
                    }}
                    variant={selectedRuleFilter === 'patch' ? 'primary' : 'outline'}
                    className="font-extrabold text-xs rounded-full flex items-center gap-1.5"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    <span>Patches & CPC ({ruleCounts.patch})</span>
                  </Button>

                  <Button
                    size="sm"
                    onPress={() => {
                      setSelectedRuleFilter('delete');
                      setCurrentPage(1);
                    }}
                    variant={selectedRuleFilter === 'delete' ? 'primary' : 'outline'}
                    className="font-extrabold text-xs rounded-full flex items-center gap-1.5"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                    <span>Delete Locks ({ruleCounts.delete})</span>
                  </Button>

                  <Button
                    size="sm"
                    onPress={() => {
                      setSelectedRuleFilter('name');
                      setCurrentPage(1);
                    }}
                    variant={selectedRuleFilter === 'name' ? 'primary' : 'outline'}
                    className="font-extrabold text-xs rounded-full flex items-center gap-1.5"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
                    <span>Name Characters ({ruleCounts.name})</span>
                  </Button>

                  <Button
                    size="sm"
                    onPress={() => {
                      setSelectedRuleFilter('others');
                      setCurrentPage(1);
                    }}
                    variant={selectedRuleFilter === 'others' ? 'primary' : 'outline'}
                    className="font-extrabold text-xs rounded-full flex items-center gap-1.5"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    <span>Others Group ({ruleCounts.others})</span>
                  </Button>
                </div>
              </div>

              {/* Required "Others" Group — positive result panel (shown only when found).
                  Kept separate from the issues table so it doesn't read as a problem. */}
              {summary.othersMatches.length > 0 && (
                <div className="bg-success-container border border-success-main/20 rounded-[28px] p-5 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-10 w-10 rounded-full bg-success-main/10 text-success-main flex items-center justify-center border border-success-main/20 shrink-0">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-black tracking-tight text-success-main">Required &quot;Others&quot; group found</h3>
                      <p className="text-[11px] text-text-secondary font-bold mt-0.5">
                        {summary.othersMatches.length} group{summary.othersMatches.length > 1 ? 's' : ''} matched the &quot;Others&quot; requirement.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2.5">
                    {summary.othersMatches.map((m) => (
                      <span
                        key={m.row}
                        className="inline-flex items-center gap-2.5 pl-3 pr-2 py-1.5 rounded-full bg-surface border border-success-main/25 shadow-xs"
                      >
                        <span className="text-[10px] font-mono font-black text-zinc-500">#{m.row}</span>
                        <span className="text-xs font-extrabold text-text-primary max-w-[200px] truncate">{m.value}</span>
                        <span className={cn(
                          "px-2 py-0.5 text-[9px] font-extrabold rounded-full uppercase tracking-tight border",
                          m.exact
                            ? "bg-success-container text-success-main border-success-main/20"
                            : "bg-primary-container text-on-primary-container border-primary/20"
                        )}>
                          {m.exact ? 'Exact' : 'Appended'}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Data Grid Card */}
              <div className="bg-surface border border-border-main rounded-[28px] overflow-hidden shadow-sm">
                
                {/* Search & Severity filter toolbar */}
                <div className="p-5 border-b border-border-main flex flex-col md:flex-row items-center justify-between gap-4 bg-background">
                  
                  {/* Search bar */}
                  <div className="w-full md:w-80 flex items-center bg-surface border border-border-main rounded-full shadow-xs px-4 py-2 gap-2.5">
                    <Search className="w-4 h-4 text-text-secondary shrink-0" />
                    <input
                      placeholder="Search Inset ID, row, message..."
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setCurrentPage(1);
                      }}
                      className="w-full bg-transparent border-0 focus:ring-0 focus:outline-none text-xs font-semibold text-text-primary placeholder:text-text-secondary/50"
                    />
                  </div>

                  {/* Material Segmented Button controls */}
                  <div className="flex items-center space-x-2 w-full md:w-auto overflow-x-auto">
                    <div className="flex bg-surface p-1 rounded-full border border-border-main shadow-inner">
                      {(['ALL', 'ERROR', 'WARNING'] as const).map((t) => {
                        const count = t === 'ALL' 
                          ? summary.issues.length 
                          : summary.issues.filter(i => i.severity === t).length;
                        const isActive = filter === t;
                        return (
                          <button
                            key={t}
                            onClick={() => {
                              setFilter(t);
                              setCurrentPage(1);
                            }}
                            className={cn(
                              "px-4 py-1.5 text-xs font-bold rounded-full transition-all flex items-center gap-1.5 select-none outline-none",
                              isActive 
                                ? "bg-[#1b1d22] text-white shadow-xs" 
                                : "text-text-secondary hover:bg-zinc-100"
                            )}
                          >
                            <span>{t === 'ALL' ? 'All Rows' : t === 'ERROR' ? 'Errors' : 'Warnings'}</span>
                            <span className="text-[10px] opacity-70 font-mono">({count})</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Data Grid table */}
                {filteredIssues.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-background border-b border-border-main">
                          <th className="px-6 py-4 w-12 text-center">
                            <input 
                              type="checkbox" 
                              checked={filteredIssues.length > 0 && filteredIssues.every(i => selectedIds.has(i.id))}
                              onChange={toggleAll}
                              className="w-4 h-4 rounded border-zinc-300 bg-surface text-primary focus:ring-0 transition-all cursor-pointer"
                            />
                          </th>
                          <th className="px-6 py-4 text-[10px] font-black text-text-secondary uppercase tracking-wider">Row</th>
                          <th className="px-6 py-4 text-[10px] font-black text-text-secondary uppercase tracking-wider">Inset ID</th>
                          <th className="px-6 py-4 text-[10px] font-black text-text-secondary uppercase tracking-wider">Rule Violation</th>
                          <th className="px-6 py-4 text-[10px] font-black text-text-secondary uppercase tracking-wider">Diagnostics & Current Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-main">
                        {paginatedIssues.map((issue) => {
                          const isSelected = selectedIds.has(issue.id);
                          return (
                            <motion.tr 
                              key={issue.id} 
                              className={cn(
                                "group transition-colors",
                                isSelected 
                                  ? "bg-primary/5 border-l-4 border-primary" 
                                  : "bg-surface hover:bg-zinc-50"
                              )}
                            >
                              <td className="px-6 py-4 text-center">
                                <input 
                                  type="checkbox" 
                                  checked={isSelected}
                                  onChange={() => toggleSelection(issue.id)}
                                  className="w-4 h-4 rounded border-zinc-300 bg-surface text-primary focus:ring-0 cursor-pointer"
                                />
                              </td>
                              <td className="px-6 py-4 text-xs font-mono font-bold text-zinc-500">{issue.row === 0 ? 'SHEET' : `#${issue.row}`}</td>
                              <td className="px-6 py-4 text-xs font-black text-text-primary">{issue.insetId}</td>
                              <td className="px-6 py-4">
                                <span className={cn(
                                  "inline-flex items-center px-2 py-0.5 text-[9px] font-extrabold rounded-full uppercase tracking-tight border",
                                  issue.severity === "ERROR" 
                                    ? "bg-error-container text-error-main border-error-main/15" 
                                    : "bg-warning-container text-warning-main border-warning-main/15"
                                )}>
                                  {issue.rule}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-xs leading-relaxed max-w-sm">
                                <span className="font-extrabold text-text-primary block">{issue.message}</span>
                                <span className="mt-2 inline-block text-[10px] text-zinc-700 font-mono italic bg-zinc-100 px-2 py-0.5 rounded border border-border-main">
                                  Current cell string: &quot;{issue.value}&quot;
                                </span>
                              </td>
                            </motion.tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 space-y-4 bg-surface">
                    <div className="p-4 rounded-full bg-success-container border border-success-main/15 text-success-main shadow-sm">
                      <CheckCircle2 className="w-8 h-8" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-black text-text-primary">No diagnostics found matching filter</p>
                      <p className="text-xs text-text-secondary font-bold mt-1">Excellent! All row validation layers returned clear pass states.</p>
                    </div>
                  </div>
                )}

                {/* Material Pagination control footer */}
                {filteredIssues.length > itemsPerPage && (
                  <div className="p-5 border-t border-border-main flex items-center justify-between bg-background text-xs">
                    <span className="text-text-secondary font-bold">
                      Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, filteredIssues.length)} of {filteredIssues.length} issues
                    </span>
                    <div className="flex items-center space-x-1.5">
                      <Button
                        size="sm"
                        onPress={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        isDisabled={currentPage === 1}
                        variant="outline"
                        className="font-bold border-border-main bg-surface hover:bg-background text-xs text-text-primary disabled:opacity-45 rounded-full"
                      >
                        Previous
                      </Button>
                      <span className="px-3 text-text-primary font-mono font-black">
                        {currentPage} / {totalPages}
                      </span>
                      <Button
                        size="sm"
                        onPress={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                        isDisabled={currentPage === totalPages}
                        variant="outline"
                        className="font-bold border-border-main bg-surface hover:bg-background text-xs text-text-primary disabled:opacity-45 rounded-full"
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Floating Material Export Pill Sheet */}
              <AnimatePresence>
                {activeIssueCount > 0 && (
                  <motion.div 
                    initial={{ y: 80, opacity: 0, x: '-50%' }}
                    animate={{ y: 0, opacity: 1, x: '-50%' }}
                    exit={{ y: 80, opacity: 0, x: '-50%' }}
                    className="fixed bottom-6 left-1/2 z-50 px-6 py-3.5 rounded-full bg-[#1b1d22] text-white shadow-2xl flex items-center gap-6 border border-border-main"
                  >
                    <div className="flex flex-col text-left">
                      <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Selection Center</span>
                      <span className="text-xs font-extrabold">{activeIssueCount} item{activeIssueCount > 1 ? 's' : ''} flagged</span>
                    </div>
                    <div className="h-6 w-[1px] bg-zinc-700" />
                    <div className="flex items-center gap-2">
                      <Button 
                        onPress={exportSelected}
                        variant="primary"
                        className="font-bold text-xs shadow-md rounded-full flex items-center gap-2"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download Report</span>
                      </Button>
                      <Button 
                        onPress={() => setSelectedIds(new Set())}
                        variant="ghost"
                        className="font-semibold text-xs text-white hover:bg-white/5 rounded-full flex items-center gap-2"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-zinc-400" />
                        <span>Clear Selection</span>
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Validation Rules Checklist Modal (Right Drawer Panel) */}
      <AnimatePresence>
        {isDrawerOpen && (
          <>
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsDrawerOpen(false)}
              className="fixed inset-0 bg-black z-50 backdrop-blur-xs"
            />
            {/* Drawer Content */}
            <motion.div 
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 bottom-0 max-w-md w-full bg-surface border-l border-border-main z-50 h-full shadow-2xl flex flex-col outline-none"
            >
              <div className="flex flex-col gap-1 border-b border-border-main py-5 px-6 shrink-0 bg-surface">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-black tracking-tight text-text-primary">Integrity Checklist</h2>
                  <button 
                    onClick={() => setIsDrawerOpen(false)}
                    className="p-1 rounded-full hover:bg-zinc-100 text-text-secondary"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <p className="text-xs text-text-secondary font-semibold mt-0.5">Rules & formats evaluated by ParallelDots</p>
              </div>

              <div className="overflow-y-auto py-6 px-6 flex-1 bg-surface">
                <div className="space-y-6">
                  {VALIDATION_RULES.map((rule, idx) => (
                    <div key={rule.id} className="space-y-2 border-b border-zinc-200 pb-5 last:border-0 last:pb-0">
                      <div className="flex items-start justify-between">
                        <span className="text-[10px] font-black text-text-secondary uppercase tracking-wider block">Rule Checklist #0{idx+1}</span>
                        <span className="px-2 py-0.5 text-[9px] font-extrabold rounded-full bg-error-container text-error-main border border-error-main/10">
                          {rule.severity}
                        </span>
                      </div>
                      <h3 className="font-extrabold text-sm tracking-tight text-text-primary">{rule.name}</h3>
                      
                      <div className="text-xs font-semibold text-text-secondary space-y-2 mt-2">
                        <p className="leading-relaxed text-text-primary">{rule.description}</p>
                        
                        <div className="bg-background p-3.5 rounded-2xl border border-border-main space-y-1.5">
                          <span className="text-[10px] text-text-secondary uppercase font-bold block">Logic Evaluated</span>
                          <p className="font-mono text-[10px] text-text-primary leading-relaxed whitespace-pre-line">{rule.logic}</p>
                        </div>

                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <div className="p-2.5 rounded-xl bg-success-container border border-success-main/15">
                            <span className="text-[9px] text-success-main font-bold block">Valid Format</span>
                            <code className="font-mono text-[10px] block mt-1 text-success-main">{rule.examplePass}</code>
                          </div>
                          <div className="p-2.5 rounded-xl bg-error-container border border-error-main/15">
                            <span className="text-[9px] text-error-main font-bold block">Disallowed</span>
                            <code className="font-mono text-[10px] block mt-1 text-error-main">{rule.exampleFail}</code>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-border-main py-4 px-6 bg-background shrink-0">
                <Button 
                  variant="primary" 
                  onPress={() => setIsDrawerOpen(false)} 
                  className="w-full font-bold text-xs rounded-full"
                >
                  Close Checklist Reference
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Material Footer */}
      <footer className="mt-auto py-8 px-6 border-t border-border-main text-center bg-surface">
        <p className="text-[10px] text-text-secondary font-black tracking-widest uppercase">
          Precision Validated &copy; 2026 ParallelDots
        </p>
      </footer>
    </div>
  );
}
