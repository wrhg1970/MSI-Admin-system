import JSZip from 'jszip';

export const createZipFromPdfs = async (pdfs: { filename: string; data: any }[]): Promise<Blob> => {
  const zip = new JSZip();
  
  pdfs.forEach(pdf => {
    // pdf.data can be a Blob, ArrayBuffer, or Base64 string
    zip.file(pdf.filename, pdf.data);
  });
  
  return await zip.generateAsync({ type: 'blob' });
};

export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
