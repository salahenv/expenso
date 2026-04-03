import { parse } from './SMSParser';

/** Fixed "now" so ICICI/Kotak/PhonePe fallback dates and GPay year are stable in tests. */
const REF = new Date('2026-03-29T12:00:00.000Z');

describe('SMSParser.parse', () => {
  const samples: { body: string; bank: string; amount: number; merchant: string }[] = [
    {
      body: 'Rs.450.00 debited from a/c **1234 on 14-03-25 for SWIGGY',
      bank: 'HDFC',
      amount: 450,
      merchant: 'SWIGGY',
    },
    {
      body: 'ICICI Bank: INR 450.00 debited from account XX1234. Info: SWIGGY',
      bank: 'ICICI',
      amount: 450,
      merchant: 'SWIGGY',
    },
    {
      body: 'Your a/c XX1234 is debited by Rs450.0 on 14-03-25 trf to SWIGGY',
      bank: 'SBI',
      amount: 450,
      merchant: 'SWIGGY',
    },
    {
      body: 'INR 450.00 debited from Axis Bank AC XX1234 on 14-Mar-25. SWIGGY',
      bank: 'Axis',
      amount: 450,
      merchant: 'SWIGGY',
    },
    {
      body: 'Rs.450 debited from Kotak Bank a/c XX1234. SWIGGY',
      bank: 'Kotak',
      amount: 450,
      merchant: 'SWIGGY',
    },
    {
      body: 'Rs.450 paid to SWIGGY via Paytm on 14/03/2025',
      bank: 'Paytm',
      amount: 450,
      merchant: 'SWIGGY',
    },
    {
      body: 'Rs.450 debited from XX1234 to SWIGGY via PhonePe',
      bank: 'PhonePe',
      amount: 450,
      merchant: 'SWIGGY',
    },
    {
      body: 'You paid Rs.450 to SWIGGY on Mar 14 via Google Pay',
      bank: 'GPay',
      amount: 450,
      merchant: 'SWIGGY',
    },
  ];

  it.each(samples)('parses $bank sample', ({ body, bank, amount, merchant }) => {
    const r = parse(body, REF);
    expect(r).not.toBeNull();
    expect(r!.bank).toBe(bank);
    expect(r!.amount).toBe(amount);
    expect(r!.merchant).toBe(merchant);
    expect(r!.type).toBe('debit');
  });

  it('HDFC date is 14 Mar 2025', () => {
    const r = parse(samples[0].body, REF);
    expect(r!.date.getFullYear()).toBe(2025);
    expect(r!.date.getMonth()).toBe(2);
    expect(r!.date.getDate()).toBe(14);
  });

  it('Paytm date is 14 Mar 2025', () => {
    const r = parse(samples[5].body, REF);
    expect(r!.date.getFullYear()).toBe(2025);
    expect(r!.date.getMonth()).toBe(2);
    expect(r!.date.getDate()).toBe(14);
  });

  it('GPay date uses Mar 14 in reference year', () => {
    const r = parse(samples[7].body, REF);
    expect(r!.date.getFullYear()).toBe(2026);
    expect(r!.date.getMonth()).toBe(2);
    expect(r!.date.getDate()).toBe(14);
  });

  it('returns null for OTP SMS', () => {
    expect(parse('Your OTP is 482910. Do not share with anyone.', REF)).toBeNull();
  });

  it('returns null for promo-style SMS', () => {
    expect(
      parse('Congratulations! You won Rs 1 Lakh. Click here to claim your prize now!', REF)
    ).toBeNull();
  });

  it('returns null for unrelated text', () => {
    expect(parse('Meeting at 5pm tomorrow — bring the report.', REF)).toBeNull();
  });

  it('parses ICICI debit with payee after "to" and comma amount', () => {
    const body =
      'ICICI Bank: INR 1,200.50 debited from A/c XX088 on 03-Apr-26 to ZOMATO. UPI Ref 999';
    const r = parse(body, REF);
    expect(r).not.toBeNull();
    expect(r!.bank).toBe('ICICI');
    expect(r!.amount).toBe(1200.5);
    expect(r!.merchant).toBe('ZOMATO');
    expect(r!.type).toBe('debit');
  });

  it('parses generic debit when templates miss', () => {
    const body =
      'Alert: Rs. 99.00 debited from A/c XX999 on 02-Apr-26 for NETFLIX SUBSCRIPTION. UPI Ref 1';
    const r = parse(body, REF);
    expect(r).not.toBeNull();
    expect(r!.bank).toBe('Generic');
    expect(r!.amount).toBe(99);
    expect(r!.merchant).toContain('NETFLIX');
    expect(r!.type).toBe('debit');
  });

  it('parses SBI UPI debit without Rs prefix and on date 03Apr26', () => {
    const body =
      'Dear UPI user A/C X4576 debited by 1000.00 on date 03Apr26 trf to Rajaram Hariram Refno 609318151356 If not u? call-1800111109 for other services-18001234-SBI';
    const r = parse(body, new Date('2026-04-03T12:00:00.000Z'));
    expect(r).not.toBeNull();
    expect(r!.bank).toBe('SBI');
    expect(r!.amount).toBe(1000);
    expect(r!.merchant).toBe('RAJARAM HARIRAM');
    expect(r!.date.getFullYear()).toBe(2026);
    expect(r!.date.getMonth()).toBe(3);
    expect(r!.date.getDate()).toBe(3);
  });

  it('does not use first Rs amount when it is balance before debited line', () => {
    const body =
      'Avl Bal Rs 107.50. ICICI Bank: INR 1,000.00 debited from A/c XX1 on 03-Apr-26 to SWIGGY. UPI';
    const r = parse(body, REF);
    expect(r).not.toBeNull();
    expect(r!.amount).toBe(1000);
    expect(r!.merchant).toBe('SWIGGY');
  });
});
