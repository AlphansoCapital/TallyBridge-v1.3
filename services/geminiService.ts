
import { GoogleGenAI, Type } from "@google/genai";
import { ColumnMapping } from "../types";

export const identifyHeaders = async (headers: string[]): Promise<ColumnMapping> => {
  // Use the API_KEY from environment variables directly as per guidelines
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `
    I have a CSV report from an eCommerce marketplace (like Amazon MTR or Flipkart Tax report). 
    Here are the headers found in the file: ${headers.join(", ")}.
    
    Identify which header corresponds to the following fields:
    - date (The invoice or transaction date)
    - invoiceNo (The unique invoice or order ID)
    - customerName (Recipient name)
    - state (Place of supply or customer state)
    - taxableValue (Net value before tax)
    - igst (Integrated GST amount)
    - cgst (Central GST amount)
    - sgst (State GST amount)
    - totalAmount (Gross amount including tax)
    - gstRate (The tax percentage rate)
    - productName (The SKU, item description, or product name)
    - quantity (Number of items sold)

    Return ONLY a JSON object mapping these fields to the headers provided. 
    If a field is not found, leave the value as an empty string.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            date: { type: Type.STRING },
            invoiceNo: { type: Type.STRING },
            customerName: { type: Type.STRING },
            state: { type: Type.STRING },
            taxableValue: { type: Type.STRING },
            igst: { type: Type.STRING },
            cgst: { type: Type.STRING },
            sgst: { type: Type.STRING },
            totalAmount: { type: Type.STRING },
            gstRate: { type: Type.STRING },
            productName: { type: Type.STRING },
            quantity: { type: Type.STRING },
          }
        }
      }
    });

    return JSON.parse(response.text) as ColumnMapping;
  } catch (error) {
    console.error("Error calling Gemini for header mapping:", error);
    // Fallback empty mapping
    return {
      date: "", invoiceNo: "", customerName: "", state: "",
      taxableValue: "", igst: "", cgst: "", sgst: "",
      totalAmount: "", gstRate: "", productName: "", quantity: ""
    };
  }
};
