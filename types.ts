
export interface MarketplaceTransaction {
  date: string;
  invoiceNo: string;
  customerName: string;
  state: string;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  totalAmount: number;
  gstRate: number;
  productName: string;
  quantity: number;
}

export interface ColumnMapping {
  date: string;
  invoiceNo: string;
  customerName: string;
  state: string;
  taxableValue: string;
  igst: string;
  cgst: string;
  sgst: string;
  totalAmount: string;
  gstRate: string;
  productName: string;
  quantity: string;
}

export interface ProcessingResult {
  transactions: MarketplaceTransaction[];
  mapping: ColumnMapping;
  fileName: string;
}

export enum AppStep {
  UPLOAD,
  MAPPING,
  REVIEW,
  EXPORT
}
