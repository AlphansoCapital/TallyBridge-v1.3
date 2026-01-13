
import { MarketplaceTransaction } from "../types";

const sanitize = (str: string) => {
  if (!str) return "";
  return str.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
};

const formatDateForTally = (dateStr: string) => {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "20240401"; // Default fallback
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
};

export const generateTallyXml = (
  transactions: MarketplaceTransaction[],
  ledgerOverrides: Record<string, string> = {}
): string => {
  const getLedgerName = (defaultName: string) => {
    const customName = ledgerOverrides[defaultName];
    return sanitize(customName && customName.trim() !== "" ? customName : defaultName);
  };

  let xml = `<?xml version="1.0"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>Ecommerce Sales</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>`;

  transactions.forEach((tx) => {
    const voucherDate = formatDateForTally(tx.date);
    const invoiceNo = sanitize(tx.invoiceNo);
    const partyName = sanitize(tx.customerName || "Cash");
    const stateName = sanitize(tx.state || "Maharashtra");
    const productName = sanitize(tx.productName || "General Item");
    const qty = tx.quantity || 1;
    const taxableVal = tx.taxableValue.toFixed(2);
    const igstVal = tx.igst.toFixed(2);
    const cgstVal = tx.cgst.toFixed(2);
    const sgstVal = tx.sgst.toFixed(2);
    const totalVal = tx.totalAmount.toFixed(2);
    const rate = tx.gstRate || 18;

    // Resolve ledger names via overrides
    const salesLedger = getLedgerName(`Sales @ ${rate}%`);
    const igstLedger = getLedgerName(`Output IGST @ ${rate}%`);
    const cgstLedger = getLedgerName(`Output CGST @ ${rate / 2}%`);
    const sgstLedger = getLedgerName(`Output SGST @ ${rate / 2}%`);

    xml += `
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Accounting Voucher View">
            <DATE>${voucherDate}</DATE>
            <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
            <REFERENCE>${invoiceNo}</REFERENCE>
            <PARTYLEDGERNAME>${partyName}</PARTYLEDGERNAME>
            <STATENAME>${stateName}</STATENAME>
            <FBTPAYMENTTYPE>Default</FBTPAYMENTTYPE>
            <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
            
            <!-- Dr Party -->
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${partyName}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>-${totalVal}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>

            <!-- Cr Sales with Inventory -->
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${salesLedger}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${taxableVal}</AMOUNT>
              <INVENTORYENTRIES.LIST>
                <STOCKITEMNAME>${productName}</STOCKITEMNAME>
                <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
                <RATE>${(tx.taxableValue / qty).toFixed(2)}</RATE>
                <AMOUNT>${taxableVal}</AMOUNT>
                <ACTUALQTY>${qty} Nos</ACTUALQTY>
                <BILLEDQTY>${qty} Nos</BILLEDQTY>
              </INVENTORYENTRIES.LIST>
            </ALLLEDGERENTRIES.LIST>`;

    if (tx.igst > 0) {
      xml += `
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${igstLedger}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${igstVal}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>`;
    }
    if (tx.cgst > 0) {
      xml += `
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${cgstLedger}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${cgstVal}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${sgstLedger}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${sgstVal}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>`;
    }

    xml += `
          </VOUCHER>
        </TALLYMESSAGE>`;
  });

  xml += `
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

  return xml;
};
