
import React, { useState, useMemo } from 'react';
import { 
  FileUp, 
  Settings2, 
  FileCode, 
  Download, 
  CheckCircle2, 
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  ChevronRight,
  ChevronDown,
  RefreshCcw,
  ExternalLink,
  Table,
  XCircle,
  AlertTriangle,
  Info,
  Trash2,
  BookOpen,
  Layers,
  FileText,
  Files,
  X,
  User,
  MapPin,
  Tag,
  Calculator,
  Edit3
} from 'lucide-react';
import { identifyHeaders } from './services/geminiService';
import { generateTallyXml } from './services/tallyXmlGenerator';
import { AppStep, MarketplaceTransaction, ColumnMapping } from './types';

interface FileData {
  name: string;
  headers: string[];
  rawData: string[][];
}

const parseCSV = (csvText: string): string[][] => {
  const lines = csvText.split(/\r?\n/);
  return lines.map(line => {
    return line.split(',').map(cell => cell.trim().replace(/^"|"$/g, ''));
  }).filter(line => line.length > 1);
};

const REQUIRED_FIELDS: (keyof ColumnMapping)[] = [
  "date", 
  "invoiceNo", 
  "customerName", 
  "taxableValue", 
  "totalAmount", 
  "gstRate",
  "productName",
  "quantity"
];

const NUMERIC_FIELDS: (keyof ColumnMapping)[] = [
  "taxableValue", "igst", "cgst", "sgst", "totalAmount", "gstRate", "quantity"
];

const DATE_FIELDS: (keyof ColumnMapping)[] = ["date"];

const App: React.FC = () => {
  const [step, setStep] = useState<AppStep>(AppStep.UPLOAD);
  const [uploadedFiles, setUploadedFiles] = useState<FileData[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({
    date: "", invoiceNo: "", customerName: "", state: "",
    taxableValue: "", igst: "", cgst: "", sgst: "",
    totalAmount: "", gstRate: "", productName: "", quantity: ""
  });
  const [transactions, setTransactions] = useState<MarketplaceTransaction[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [expandedRowIndex, setExpandedRowIndex] = useState<number | null>(null);
  const [ledgerOverrides, setLedgerOverrides] = useState<Record<string, string>>({});

  // The union of all unique headers across all uploaded files
  const allHeaders = useMemo(() => {
    const headerSet = new Set<string>();
    uploadedFiles.forEach(f => f.headers.forEach(h => headerSet.add(h)));
    return Array.from(headerSet);
  }, [uploadedFiles]);

  // Helper to get sample data for a mapped column (from first file that has it)
  const getSampleData = (header: string, count: number = 3) => {
    for (const file of uploadedFiles) {
      const idx = file.headers.indexOf(header);
      if (idx !== -1) {
        return file.rawData.slice(0, count).map(row => row[idx]).filter(val => val !== undefined);
      }
    }
    return [];
  };

  // Validation logic for data integrity
  const validationResults = useMemo(() => {
    const errors: Record<string, string> = {};
    const warnings: Record<string, string> = {};
    const samples: Record<string, string[]> = {};
    const usedHeaders = new Map<string, string[]>();

    (Object.keys(mapping) as (keyof ColumnMapping)[]).forEach((key) => {
      const header = mapping[key];
      
      if (REQUIRED_FIELDS.includes(key) && !header) {
        errors[key] = "This field is required for Tally import.";
        return;
      }

      if (header) {
        if (!usedHeaders.has(header)) {
          usedHeaders.set(header, []);
        }
        usedHeaders.get(header)?.push(key);

        const sampleValues = getSampleData(header);
        samples[key] = sampleValues;

        if (NUMERIC_FIELDS.includes(key) && sampleValues.length > 0) {
          const isNumeric = sampleValues.every(val => {
            if (!val) return true;
            const num = val.replace(/[^0-9.-]+/g, "");
            return !isNaN(parseFloat(num)) && isFinite(Number(num));
          });
          if (!isNumeric) {
            warnings[key] = "Values in some files don't look like numbers.";
          }
        }

        if (DATE_FIELDS.includes(key) && sampleValues.length > 0) {
          const isDate = sampleValues.every(val => {
            if (!val) return true;
            return !isNaN(Date.parse(val));
          });
          if (!isDate) {
            warnings[key] = "Values in some files don't look like valid dates.";
          }
        }
      }
    });

    usedHeaders.forEach((keys, header) => {
      if (keys.length > 1) {
        keys.forEach(key => {
          errors[key] = `Duplicate mapping: "${header}" is also used for ${keys.filter(k => k !== key).map(k => k.replace(/([A-Z])/g, ' $1')).join(', ')}.`;
        });
      }
    });

    return { errors, warnings, samples };
  }, [mapping, uploadedFiles]);

  const hasCriticalErrors = useMemo(() => {
    return Object.keys(validationResults.errors).length > 0;
  }, [validationResults.errors]);

  // Extract unique tax rates and suggest ledgers
  const suggestedLedgers = useMemo(() => {
    const rates = new Set<number>();
    const hasIgst = transactions.some(t => t.igst > 0);
    const hasCgstSgst = transactions.some(t => t.cgst > 0 || t.sgst > 0);
    
    transactions.forEach(t => {
      if (t.gstRate > 0) rates.add(t.gstRate);
    });

    const ledgers: { name: string; type: string; rate?: number }[] = [];
    Array.from(rates).sort((a, b) => a - b).forEach(rate => {
      ledgers.push({ name: `Sales @ ${rate}%`, type: 'Sales Ledger', rate });
      if (hasIgst) {
        ledgers.push({ name: `Output IGST @ ${rate}%`, type: 'Tax Ledger', rate });
      }
      if (hasCgstSgst) {
        ledgers.push({ name: `Output CGST @ ${rate / 2}%`, type: 'Tax Ledger', rate });
        ledgers.push({ name: `Output SGST @ ${rate / 2}%`, type: 'Tax Ledger', rate });
      }
    });

    return ledgers;
  }, [transactions]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);
    const newFiles: FileData[] = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const text = await file.text();
      const data = parseCSV(text);
      if (data.length > 0) {
        newFiles.push({
          name: file.name,
          headers: data[0],
          rawData: data.slice(1)
        });
      }
    }

    setUploadedFiles(prev => [...prev, ...newFiles]);
    setIsProcessing(false);
  };

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const startMapping = async () => {
    if (uploadedFiles.length === 0) return;
    setIsProcessing(true);
    try {
      // Use headers from the first file as a baseline for AI identification
      const aiMapping = await identifyHeaders(uploadedFiles[0].headers);
      setMapping(aiMapping);
      setStep(AppStep.MAPPING);
    } catch (err) {
      console.error(err);
      setStep(AppStep.MAPPING);
    }
    setIsProcessing(false);
  };

  const processMapping = () => {
    if (hasCriticalErrors) return;

    setIsProcessing(true);
    let allProcessed: MarketplaceTransaction[] = [];

    uploadedFiles.forEach(file => {
      const fileTransactions: MarketplaceTransaction[] = file.rawData.map(row => {
        const getVal = (field: keyof ColumnMapping) => {
          const header = mapping[field];
          const idx = file.headers.indexOf(header);
          return idx !== -1 ? row[idx] : "";
        };

        const parseFloatSafe = (val: string) => parseFloat(val.replace(/[^0-9.-]+/g, "")) || 0;

        return {
          date: getVal("date"),
          invoiceNo: getVal("invoiceNo"),
          customerName: getVal("customerName"),
          state: getVal("state"),
          taxableValue: parseFloatSafe(getVal("taxableValue")),
          igst: parseFloatSafe(getVal("igst")),
          cgst: parseFloatSafe(getVal("cgst")),
          sgst: parseFloatSafe(getVal("sgst")),
          totalAmount: parseFloatSafe(getVal("totalAmount")),
          gstRate: parseFloatSafe(getVal("gstRate")),
          productName: getVal("productName") || "General Item",
          quantity: parseFloatSafe(getVal("quantity")) || 1
        };
      });
      allProcessed = [...allProcessed, ...fileTransactions];
    });

    setTransactions(allProcessed);
    setIsProcessing(false);
    setStep(AppStep.REVIEW);
    setExpandedRowIndex(null);
  };

  const handleDownload = () => {
    const xml = generateTallyXml(transactions, ledgerOverrides);
    const blob = new Blob([xml], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Consolidated_TallyExport_${new Date().toISOString().split('T')[0]}.xml`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const clearMappings = () => {
    setMapping({
      date: "", invoiceNo: "", customerName: "", state: "",
      taxableValue: "", igst: "", cgst: "", sgst: "",
      totalAmount: "", gstRate: "", productName: "", quantity: ""
    });
  };

  const toggleRow = (index: number) => {
    setExpandedRowIndex(expandedRowIndex === index ? null : index);
  };

  const handleLedgerOverride = (defaultName: string, customName: string) => {
    setLedgerOverrides(prev => ({
      ...prev,
      [defaultName]: customName
    }));
  };

  return (
    <div className="flex flex-col min-h-screen">
      <header className="bg-indigo-700 text-white p-4 shadow-lg sticky top-0 z-50">
        <div className="container mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="bg-white p-1.5 rounded-lg shadow-inner">
              <FileCode className="w-6 h-6 text-indigo-700" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">TallyBridge <span className="font-light opacity-80 text-sm">v1.3</span></h1>
          </div>
          <div className="hidden md:flex gap-4 text-sm font-medium">
            <span className={step >= AppStep.UPLOAD ? "text-white" : "text-indigo-300"}>1. Upload</span>
            <ChevronRight className="w-4 h-4 text-indigo-400" />
            <span className={step >= AppStep.MAPPING ? "text-white" : "text-indigo-300"}>2. Map</span>
            <ChevronRight className="w-4 h-4 text-indigo-400" />
            <span className={step >= AppStep.REVIEW ? "text-white" : "text-indigo-300"}>3. Review</span>
            <ChevronRight className="w-4 h-4 text-indigo-400" />
            <span className={step >= AppStep.EXPORT ? "text-white" : "text-indigo-300"}>4. Export</span>
          </div>
        </div>
      </header>

      <main className="flex-grow container mx-auto px-4 py-8">
        {step === AppStep.UPLOAD && (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100 text-center">
              <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <FileUp className="w-10 h-10 text-indigo-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-800 mb-2">Convert Marketplace Reports</h2>
              <p className="text-gray-500 mb-8">Upload multiple CSV MTR or Tax reports and get a single consolidated Tally XML.</p>
              
              <div className="relative group max-w-xl mx-auto">
                <input 
                  type="file" 
                  accept=".csv"
                  multiple
                  onChange={handleFileUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
                />
                <div className="border-2 border-dashed border-indigo-200 group-hover:border-indigo-400 rounded-xl p-8 transition-all bg-indigo-50/30 group-hover:bg-indigo-50/50">
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-indigo-600 font-semibold text-lg">Click to select files or drag and drop</span>
                    <span className="text-gray-400 text-sm">You can select multiple files at once</span>
                  </div>
                </div>
              </div>

              {uploadedFiles.length > 0 && (
                <div className="mt-8 text-left">
                  <div className="flex items-center justify-between mb-4 border-b border-gray-100 pb-2">
                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                      <Files className="w-4 h-4" /> Selected Files ({uploadedFiles.length})
                    </h3>
                    <button 
                      onClick={() => setUploadedFiles([])}
                      className="text-xs font-bold text-red-500 hover:text-red-700"
                    >
                      Clear All
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {uploadedFiles.map((f, i) => (
                      <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100 group">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <FileText className="w-5 h-5 text-indigo-400 shrink-0" />
                          <div className="overflow-hidden">
                            <p className="text-sm font-semibold text-gray-700 truncate" title={f.name}>{f.name}</p>
                            <p className="text-[10px] text-gray-400 uppercase font-bold">{f.rawData.length} Transactions</p>
                          </div>
                        </div>
                        <button 
                          onClick={() => removeFile(i)}
                          className="p-1 text-gray-300 hover:text-red-500 transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="mt-8 flex justify-center">
                    <button 
                      onClick={startMapping}
                      disabled={isProcessing}
                      className="px-10 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-lg transition-all flex items-center gap-2"
                    >
                      {isProcessing ? (
                        <><RefreshCcw className="w-5 h-5 animate-spin" /> Processing...</>
                      ) : (
                        <>Start Mapping <ArrowRight className="w-5 h-5" /></>
                      )}
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
                <div className="p-4 rounded-lg bg-gray-50 border border-gray-100">
                  <div className="w-8 h-8 bg-white rounded shadow-sm flex items-center justify-center mb-3">
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                  </div>
                  <h3 className="font-bold text-gray-700 text-sm mb-1">Batch Conversion</h3>
                  <p className="text-xs text-gray-500">Combine reports from different months into one XML.</p>
                </div>
                <div className="p-4 rounded-lg bg-gray-50 border border-gray-100">
                  <div className="w-8 h-8 bg-white rounded shadow-sm flex items-center justify-center mb-3">
                    <Layers className="w-5 h-5 text-blue-500" />
                  </div>
                  <h3 className="font-bold text-gray-700 text-sm mb-1">Unified Mapping</h3>
                  <p className="text-xs text-gray-500">Map columns once, apply to all uploaded reports.</p>
                </div>
                <div className="p-4 rounded-lg bg-gray-50 border border-gray-100">
                  <div className="w-8 h-8 bg-white rounded shadow-sm flex items-center justify-center mb-3">
                    <Download className="w-5 h-5 text-purple-500" />
                  </div>
                  <h3 className="font-bold text-gray-700 text-sm mb-1">Tally Compliant</h3>
                  <p className="text-xs text-gray-500">XML perfectly structured for Tally Prime/ERP9 import.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === AppStep.MAPPING && (
          <div className="max-w-6xl mx-auto">
            <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">
              <div className="bg-gray-50 p-6 border-b border-gray-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="flex items-center gap-3">
                  <div className="bg-indigo-100 p-2 rounded-lg">
                    <Settings2 className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-800">Verify Unified Mapping</h2>
                    <p className="text-sm text-gray-500">Ensure mappings apply correctly to all {uploadedFiles.length} files.</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                   <button 
                    onClick={clearMappings}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Clear All
                  </button>
                  <div className="text-left md:text-right bg-white px-3 py-1 rounded-full shadow-sm border border-gray-200">
                    <span className="text-[10px] font-bold text-gray-400 block uppercase leading-tight">Processing</span>
                    <span className="text-xs font-semibold text-indigo-600 truncate max-w-[200px] block">{uploadedFiles.length} files</span>
                  </div>
                </div>
              </div>

              {hasCriticalErrors && (
                <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-100 rounded-lg flex items-center gap-3 text-red-700 text-sm">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <span>Please resolve all mapping errors. Mappings must be unique across all available headers.</span>
                </div>
              )}
              
              <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-8">
                {(Object.keys(mapping) as (keyof ColumnMapping)[]).map((key) => {
                  const error = validationResults.errors[key];
                  const warning = validationResults.warnings[key];
                  const sample = validationResults.samples[key];
                  const isRequired = REQUIRED_FIELDS.includes(key);
                  
                  return (
                    <div key={key} className="flex flex-col gap-1.5 relative group">
                      <div className="flex justify-between items-center">
                        <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                          {key.replace(/([A-Z])/g, ' $1')}
                          {isRequired && <span className="text-red-500" title="Required field">*</span>}
                        </label>
                        <div className="flex items-center gap-1.5">
                           {mapping[key] && !error && !warning && <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}
                           {warning && <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />}
                           {error && <XCircle className="w-3.5 h-3.5 text-red-500" />}
                        </div>
                      </div>
                      <select 
                        value={mapping[key]}
                        onChange={(e) => setMapping({...mapping, [key]: e.target.value})}
                        className={`w-full p-2.5 bg-white border rounded-lg text-sm focus:ring-2 transition-all outline-none appearance-none ${
                          error 
                            ? 'border-red-300 bg-red-50/30 focus:ring-red-200' 
                            : warning
                              ? 'border-orange-200 bg-orange-50/30 focus:ring-orange-200'
                              : 'border-gray-200 focus:ring-indigo-500 hover:border-indigo-300'
                        }`}
                      >
                        <option value="">-- Select Column --</option>
                        {allHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                      
                      <div className="min-h-[32px] mt-1 space-y-1">
                        {error && (
                          <span className="text-[10px] font-bold text-red-500 leading-tight block">
                            {error}
                          </span>
                        )}
                        {warning && !error && (
                          <span className="text-[10px] font-medium text-orange-500 leading-tight block italic">
                            {warning}
                          </span>
                        )}
                        {mapping[key] && sample && sample.length > 0 && (
                          <div className="flex items-start gap-1 text-[9px] text-gray-400 overflow-hidden">
                            <Info className="w-2.5 h-2.5 mt-0.5 shrink-0" />
                            <span className="truncate italic">Sample: {sample.join(', ')}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="p-6 bg-gray-50 border-t border-gray-100 flex flex-col sm:flex-row justify-between items-center gap-4">
                <button 
                  onClick={() => setStep(AppStep.UPLOAD)}
                  className="w-full sm:w-auto px-6 py-2.5 rounded-lg font-semibold text-gray-600 flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" /> Back to Upload
                </button>
                <div className="flex items-center gap-4 w-full sm:w-auto">
                  <button 
                    onClick={processMapping}
                    disabled={hasCriticalErrors || isProcessing}
                    className={`w-full sm:w-auto px-8 py-2.5 rounded-lg font-bold text-white flex items-center justify-center gap-2 shadow-md transition-all ${
                      hasCriticalErrors 
                        ? 'bg-gray-300 cursor-not-allowed shadow-none' 
                        : 'bg-indigo-600 hover:bg-indigo-700 hover:shadow-lg'
                    }`}
                  >
                    {isProcessing ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <>Verify Batch <ArrowRight className="w-4 h-4" /></>}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === AppStep.REVIEW && (
          <div className="max-w-7xl mx-auto space-y-6">
            {/* Tally Ledger Preparation Guide with Explicit Mapping Support */}
            <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">
               <div className="bg-indigo-50 p-4 border-b border-indigo-100 flex items-center gap-3">
                  <BookOpen className="w-5 h-5 text-indigo-600" />
                  <div>
                    <h3 className="font-bold text-indigo-900 text-sm">Tally Ledger Preparation Guide</h3>
                    <p className="text-xs text-indigo-700">Consolidated from {uploadedFiles.length} reports. Ensure these names match your Tally ledgers.</p>
                  </div>
               </div>
               <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {suggestedLedgers.map((ledger, idx) => (
                    <div key={idx} className="flex flex-col p-3 bg-gray-50 rounded-xl border border-gray-100 hover:border-indigo-200 transition-all group/ledger">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold text-gray-400 uppercase">{ledger.type}</span>
                        <div className="flex items-center gap-1 opacity-0 group-hover/ledger:opacity-100 transition-opacity">
                           <Edit3 className="w-2.5 h-2.5 text-indigo-400" />
                           <span className="text-[9px] text-indigo-400 font-bold uppercase">Map Custom</span>
                        </div>
                      </div>
                      <input 
                        type="text"
                        value={ledgerOverrides[ledger.name] || ledger.name}
                        placeholder={ledger.name}
                        onChange={(e) => handleLedgerOverride(ledger.name, e.target.value)}
                        className="text-sm font-bold text-indigo-700 bg-transparent border-b border-dashed border-transparent hover:border-indigo-300 focus:border-indigo-600 outline-none w-full pb-0.5"
                        title="Click to rename this ledger for Tally import"
                      />
                    </div>
                  ))}
               </div>
            </div>

            <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">
              <div className="p-6 border-b border-gray-100 flex flex-col sm:flex-row justify-between items-center bg-white sticky top-0 z-10 gap-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-800">Consolidated Review ({transactions.length} Vouchers)</h2>
                  <p className="text-sm text-gray-500">Summary across {uploadedFiles.length} files. Click any row to view full details.</p>
                </div>
                <div className="flex gap-3 w-full sm:w-auto">
                  <button 
                    onClick={() => setStep(AppStep.MAPPING)}
                    className="flex-1 sm:flex-none px-4 py-2 rounded-lg font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors"
                  >
                    Edit Mapping
                  </button>
                  <button 
                    onClick={() => {
                      handleDownload();
                      setStep(AppStep.EXPORT);
                    }}
                    className="flex-1 sm:flex-none px-6 py-2 rounded-lg font-bold text-white bg-green-600 flex items-center justify-center gap-2 hover:bg-green-700 shadow-md transition-all"
                  >
                    Export Unified XML <Download className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto max-h-[60vh]">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-gray-50 sticky top-0 shadow-sm">
                    <tr>
                      <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-wider w-10"></th>
                      <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Date</th>
                      <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Invoice No</th>
                      <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Product / Item</th>
                      <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-center">Qty</th>
                      <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-right">Taxable</th>
                      <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {transactions.slice(0, 100).map((tx, idx) => (
                      <React.Fragment key={idx}>
                        <tr 
                          onClick={() => toggleRow(idx)}
                          className={`cursor-pointer transition-colors ${expandedRowIndex === idx ? 'bg-indigo-50/50' : 'hover:bg-gray-50'}`}
                        >
                          <td className="p-4">
                            {expandedRowIndex === idx ? <ChevronDown className="w-4 h-4 text-indigo-600" /> : <ChevronRight className="w-4 h-4 text-gray-300" />}
                          </td>
                          <td className="p-4 text-sm text-gray-700 whitespace-nowrap">{tx.date}</td>
                          <td className="p-4 text-sm font-mono text-gray-600 whitespace-nowrap">{tx.invoiceNo}</td>
                          <td className="p-4 text-sm font-medium text-gray-800 truncate max-w-[200px]" title={tx.productName}>{tx.productName}</td>
                          <td className="p-4 text-sm text-gray-700 text-center font-bold">{tx.quantity}</td>
                          <td className="p-4 text-sm text-gray-700 text-right font-mono">₹{tx.taxableValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td className="p-4 text-sm font-bold text-indigo-700 text-right font-mono">₹{tx.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>
                        {expandedRowIndex === idx && (
                          <tr>
                            <td colSpan={7} className="p-0 border-none">
                              <div className="bg-indigo-50/30 border-y border-indigo-100/50 p-6 animate-in slide-in-from-top-1 duration-200">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                  {/* Entity Details */}
                                  <div className="space-y-4">
                                    <div className="flex items-center gap-2 text-indigo-600 font-bold text-xs uppercase tracking-widest">
                                      <User className="w-3.5 h-3.5" /> Entity Details
                                    </div>
                                    <div className="bg-white rounded-lg p-3 border border-indigo-100 space-y-2">
                                      <div>
                                        <p className="text-[10px] font-bold text-gray-400 uppercase">Customer Name</p>
                                        <p className="text-sm font-semibold text-gray-800">{tx.customerName || "Not Provided"}</p>
                                      </div>
                                      <div>
                                        <p className="text-[10px] font-bold text-gray-400 uppercase flex items-center gap-1"><MapPin className="w-2.5 h-2.5" /> State / POS</p>
                                        <p className="text-sm font-semibold text-gray-800">{tx.state || "Not Provided"}</p>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Product Info */}
                                  <div className="space-y-4">
                                    <div className="flex items-center gap-2 text-indigo-600 font-bold text-xs uppercase tracking-widest">
                                      <Tag className="w-3.5 h-3.5" /> Product Information
                                    </div>
                                    <div className="bg-white rounded-lg p-3 border border-indigo-100 space-y-2">
                                      <div>
                                        <p className="text-[10px] font-bold text-gray-400 uppercase">Item Name</p>
                                        <p className="text-sm font-semibold text-gray-800 truncate" title={tx.productName}>{tx.productName}</p>
                                      </div>
                                      <div className="grid grid-cols-2 gap-4">
                                        <div>
                                          <p className="text-[10px] font-bold text-gray-400 uppercase">Quantity</p>
                                          <p className="text-sm font-semibold text-gray-800">{tx.quantity}</p>
                                        </div>
                                        <div>
                                          <p className="text-[10px] font-bold text-gray-400 uppercase">GST Rate</p>
                                          <p className="text-sm font-semibold text-gray-800">{tx.gstRate}%</p>
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Tax Analysis */}
                                  <div className="space-y-4">
                                    <div className="flex items-center gap-2 text-indigo-600 font-bold text-xs uppercase tracking-widest">
                                      <Calculator className="w-3.5 h-3.5" /> Tax Breakdown
                                    </div>
                                    <div className="bg-white rounded-lg p-3 border border-indigo-100">
                                      <div className="space-y-1.5">
                                        <div className="flex justify-between text-xs">
                                          <span className="text-gray-500">Taxable Value</span>
                                          <span className="font-mono text-gray-800">₹{tx.taxableValue.toFixed(2)}</span>
                                        </div>
                                        {tx.igst > 0 && (
                                          <div className="flex justify-between text-xs">
                                            <span className="text-gray-500">Integrated GST (IGST)</span>
                                            <span className="font-mono text-gray-800">₹{tx.igst.toFixed(2)}</span>
                                          </div>
                                        )}
                                        {tx.cgst > 0 && (
                                          <div className="flex justify-between text-xs">
                                            <span className="text-gray-500">Central GST (CGST)</span>
                                            <span className="font-mono text-gray-800">₹{tx.cgst.toFixed(2)}</span>
                                          </div>
                                        )}
                                        {tx.sgst > 0 && (
                                          <div className="flex justify-between text-xs">
                                            <span className="text-gray-500">State GST (SGST)</span>
                                            <span className="font-mono text-gray-800">₹{tx.sgst.toFixed(2)}</span>
                                          </div>
                                        )}
                                        <div className="pt-2 border-t border-gray-100 flex justify-between text-sm font-bold text-indigo-700">
                                          <span>Voucher Total</span>
                                          <span className="font-mono">₹{tx.totalAmount.toFixed(2)}</span>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                    {transactions.length > 100 && (
                      <tr>
                        <td colSpan={7} className="p-4 text-center bg-gray-50 text-gray-400 text-sm italic">
                          Previewing 100 of {transactions.length} total transactions
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="p-4 bg-indigo-50 flex items-center gap-4 border-t border-indigo-100">
                <AlertCircle className="w-5 h-5 text-indigo-500 shrink-0" />
                <p className="text-xs text-indigo-700">
                  <strong>Consolidation Tip:</strong> Use the <strong>Preparation Guide</strong> above to map specific tax rates to your custom Tally ledger names before exporting.
                </p>
              </div>
            </div>
          </div>
        )}

        {step === AppStep.EXPORT && (
          <div className="max-w-2xl mx-auto text-center py-12">
            <div className="bg-white rounded-2xl shadow-xl p-10 border border-gray-100">
              <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="w-12 h-12 text-green-500" />
              </div>
              <h2 className="text-3xl font-bold text-gray-800 mb-2">Consolidated Export Ready!</h2>
              <p className="text-gray-500 mb-8">Generated {transactions.length} vouchers from {uploadedFiles.length} files. Import this single file into Tally for the full batch.</p>
              
              <div className="space-y-4 text-left mb-10">
                <div className="flex gap-4 p-4 rounded-xl bg-gray-50">
                  <span className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-sm shrink-0">1</span>
                  <div>
                    <h4 className="font-bold text-gray-700">Open Tally Prime</h4>
                    <p className="text-sm text-gray-500">Go to <strong>Import</strong> (Alt+O) > <strong>Vouchers</strong>.</p>
                  </div>
                </div>
                <div className="flex gap-4 p-4 rounded-xl bg-gray-50">
                  <span className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-sm shrink-0">2</span>
                  <div>
                    <h4 className="font-bold text-gray-700">Import File</h4>
                    <p className="text-sm text-gray-500">Select the downloaded consolidated XML file.</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <button 
                  onClick={() => {
                    setUploadedFiles([]);
                    setTransactions([]);
                    setLedgerOverrides({});
                    setStep(AppStep.UPLOAD);
                  }}
                  className="px-6 py-3 rounded-lg font-bold text-gray-600 border border-gray-200 hover:bg-gray-50 transition-all flex items-center justify-center gap-2"
                >
                  <RefreshCcw className="w-4 h-4" /> Start New Batch
                </button>
                <button 
                   onClick={handleDownload}
                   className="px-6 py-3 rounded-lg font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-all shadow-lg flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" /> Download Unified XML
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="bg-white border-t border-gray-100 p-6 mt-12">
        <div className="container mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-gray-400 text-sm">© 2024 TallyBridge • Multi-File Consolidated Compliance Tool</p>
          <div className="flex gap-6">
            <a href="#" className="text-gray-400 hover:text-indigo-600 flex items-center gap-1 text-sm"><ExternalLink className="w-3 h-3" /> Help Center</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
