import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  categorize,
  loadCorrections,
  saveCorrection,
  UNCATEGORIZED,
} from './Categorizer';

describe('Categorizer (US-1.3)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('Layer 1: exact match from merchants.json', async () => {
    await expect(categorize('SWIGGY')).resolves.toBe('Food');
    await expect(categorize('zerodha')).resolves.toBe('Finance');
  });

  it('Layer 2: keyword match when no exact entry', async () => {
    await expect(categorize('JOE RESTAURANT MUMBAI')).resolves.toBe('Food');
    await expect(categorize('CITY PETROL PUMP')).resolves.toBe('Transport');
  });

  it('Layer 3: user correction overrides Layer 1 and 2', async () => {
    await expect(categorize('SWIGGY')).resolves.toBe('Food');
    await saveCorrection('SWIGGY', 'Transport');
    await expect(categorize('swiggy')).resolves.toBe('Transport');
    const corrections = await loadCorrections();
    expect(corrections['SWIGGY']).toBe('Transport');
  });

  it('returns Uncategorized when nothing matches', async () => {
    await expect(categorize('RANDOM MERCHANT XYZ123')).resolves.toBe(UNCATEGORIZED);
  });
});
