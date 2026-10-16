export async function extractPdfText(buffer) {
  if(!Buffer.isBuffer(buffer)||buffer.subarray(0,5).toString()!=="%PDF-")throw new Error("Graph did not return a valid PDF.");
  const {PDFParse}=await import("pdf-parse");
  const parser=new PDFParse({data:new Uint8Array(buffer)});
  try{return (await parser.getText()).text;}finally{await parser.destroy();}
}
