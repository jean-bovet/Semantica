import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as XLSX from 'xlsx';
import { parseXLSX, parseXLS } from '../../src/main/parsers/xlsx';
import { parseCSV, parseTSV } from '../../src/main/parsers/csv';

describe('Spreadsheet Parsers', () => {
  let tempDir: string;
  
  beforeAll(() => {
    // Create a temporary directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spreadsheet-test-'));
  });
  
  afterAll(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });
  
  describe('XLSX Parser', () => {
    it('should parse a simple XLSX file', async () => {
      // Create a test XLSX file
      const testData = [
        ['Name', 'Age', 'City'],
        ['John', 30, 'New York'],
        ['Jane', 25, 'London'],
        ['Bob', 35, 'Paris']
      ];
      
      const ws = XLSX.utils.aoa_to_sheet(testData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'TestSheet');
      
      const testFile = path.join(tempDir, 'test.xlsx');
      XLSX.writeFile(wb, testFile);
      
      // Parse the file
      const result = await parseXLSX(testFile);
      
      // Verify the content
      expect(result).toContain('Sheet: TestSheet');
      expect(result).toContain('Name,Age,City');
      expect(result).toContain('John,30,New York');
      expect(result).toContain('Jane,25,London');
      expect(result).toContain('Bob,35,Paris');
    });
    
    it('should handle multiple sheets', async () => {
      // Create a workbook with multiple sheets
      const sheet1Data = [['A', 'B'], ['1', '2']];
      const sheet2Data = [['X', 'Y'], ['3', '4']];
      
      const ws1 = XLSX.utils.aoa_to_sheet(sheet1Data);
      const ws2 = XLSX.utils.aoa_to_sheet(sheet2Data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws1, 'Sheet1');
      XLSX.utils.book_append_sheet(wb, ws2, 'Sheet2');
      
      const testFile = path.join(tempDir, 'multi-sheet.xlsx');
      XLSX.writeFile(wb, testFile);
      
      const result = await parseXLSX(testFile);
      
      expect(result).toContain('Sheet: Sheet1');
      expect(result).toContain('Sheet: Sheet2');
      expect(result).toContain('A,B');
      expect(result).toContain('X,Y');
    });
    
    it('should handle empty XLSX file', async () => {
      // Create an empty workbook
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([]);
      XLSX.utils.book_append_sheet(wb, ws, 'Empty');
      
      const testFile = path.join(tempDir, 'empty.xlsx');
      XLSX.writeFile(wb, testFile);
      
      const result = await parseXLSX(testFile);
      
      // Empty sheet still shows the sheet name
      expect(result).toContain('Sheet: Empty');
    });
    
    it('should handle XLS format (legacy Excel)', async () => {
      // Create a test XLS file
      const testData = [
        ['Product', 'Price'],
        ['Apple', 1.50],
        ['Banana', 0.75]
      ];
      
      const ws = XLSX.utils.aoa_to_sheet(testData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Products');
      
      const testFile = path.join(tempDir, 'test.xls');
      XLSX.writeFile(wb, testFile, { bookType: 'xls' });
      
      const result = await parseXLS(testFile);
      
      expect(result).toContain('Product,Price');
      expect(result).toContain('Apple,1.5');
      expect(result).toContain('Banana,0.75');
    });
  });
  
  describe('CSV Parser', () => {
    it('should parse a simple CSV file', async () => {
      const csvContent = `Name,Age,City
John,30,New York
Jane,25,London
Bob,35,Paris`;
      
      const testFile = path.join(tempDir, 'test.csv');
      fs.writeFileSync(testFile, csvContent);
      
      const result = await parseCSV(testFile);
      
      expect(result).toContain('Name Age City');
      expect(result).toContain('John 30 New York');
      expect(result).toContain('Jane 25 London');
      expect(result).toContain('Bob 35 Paris');
    });
    
    it('should handle CSV with quoted fields', async () => {
      const csvContent = `"Name","Description","Price"
"Product A","Contains, comma",10.50
"Product B","Has ""quotes""",20.00`;
      
      const testFile = path.join(tempDir, 'quoted.csv');
      fs.writeFileSync(testFile, csvContent);
      
      const result = await parseCSV(testFile);
      
      expect(result).toContain('Product A Contains, comma 10.50');
      expect(result).toContain('Product B Has "quotes" 20.00');
    });
    
    it('should handle empty CSV file', async () => {
      const testFile = path.join(tempDir, 'empty.csv');
      fs.writeFileSync(testFile, '');
      
      const result = await parseCSV(testFile);
      
      expect(result).toBe('');
    });
    
    it('should handle CSV with different encodings', async () => {
      // Test with UTF-8 BOM
      const csvContent = '\ufeff' + 'Name,Value\nTest,123';
      const testFile = path.join(tempDir, 'utf8-bom.csv');
      fs.writeFileSync(testFile, csvContent);
      
      const result = await parseCSV(testFile);
      
      expect(result).toContain('Name Value');
      expect(result).toContain('Test 123');
    });
  });
  
  describe('TSV Parser', () => {
    it('should parse a simple TSV file', async () => {
      const tsvContent = `Name\tAge\tCity
John\t30\tNew York
Jane\t25\tLondon`;
      
      const testFile = path.join(tempDir, 'test.tsv');
      fs.writeFileSync(testFile, tsvContent);
      
      const result = await parseTSV(testFile);
      
      expect(result).toContain('Name Age City');
      expect(result).toContain('John 30 New York');
      expect(result).toContain('Jane 25 London');
    });
    
    it('should handle TSV with empty fields', async () => {
      const tsvContent = `A\tB\tC
1\t\t3
\t2\t`;
      
      const testFile = path.join(tempDir, 'sparse.tsv');
      fs.writeFileSync(testFile, tsvContent);
      
      const result = await parseTSV(testFile);
      
      expect(result).toContain('A B C');
      expect(result).toContain('1  3'); // Empty field becomes space
      expect(result).toContain(' 2'); // Empty field at start becomes space
    });
  });
  
  describe('Error Handling', () => {
    it('should handle non-existent XLSX file gracefully', async () => {
      const result = await parseXLSX('/non/existent/file.xlsx');
      expect(result).toBe('');
    });
    
    it('should handle non-existent CSV file gracefully', async () => {
      const result = await parseCSV('/non/existent/file.csv');
      expect(result).toBe('');
    });
    
    it('should handle corrupted XLSX file gracefully', async () => {
      const testFile = path.join(tempDir, 'corrupted.xlsx');
      fs.writeFileSync(testFile, 'This is not a valid XLSX file');
      
      const result = await parseXLSX(testFile);
      // XLSX library tries to parse it as text
      expect(result.length).toBeGreaterThan(0);
    });
  });
});