export interface Transaction {
  id: string;
  amount: number;
  merchant: string;
  category: string;
  date: string;
  source: 'sms' | 'manual';
  rawSMS?: string;
  note?: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  icon: string;
}

export interface MerchantMap {
  merchant: string;
  category: string;
}

/** Structured bank SMS (US-1.2). */
export interface ParsedSMS {
  amount: number;
  merchant: string;
  date: Date;
  type: 'debit' | 'credit';
  bank: string;
}
