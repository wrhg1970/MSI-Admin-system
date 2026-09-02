import JSZip from 'jszip';

export const createZipFromPdfs = async (pdfs: { filename: string; data: any }[]): Promise<Blob> => {
  const zip = new JSZip();
  
  pdfs.forEach(pdf => {
    // pdf.data can be a Blob, ArrayBuffer, or Base64 string
    zip.file(pdf.filename, pdf.data);
  });
  
  return await zip.generateAsync({ type: 'blob' });
};

/**
 * Creates a ZIP file containing all attached claim documents
 */
export const createZipFromClaimDocuments = async (
  documents: { name: string; url: string; data?: string }[]
): Promise<{ base64Zip: string; blob: Blob }> => {
  const zip = new JSZip();

  if (documents && documents.length > 0) {
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      let fileName = doc.name || `documento_${i + 1}`;
      try {
        if (doc.url && (doc.url.startsWith('http://') || doc.url.startsWith('https://'))) {
          const res = await fetch(doc.url);
          const blob = await res.blob();
          zip.file(fileName, blob);
        } else if (doc.url && doc.url.startsWith('data:')) {
          const parts = doc.url.split(',');
          const base64Data = parts[1];
          zip.file(fileName, base64Data, { base64: true });
        } else if (doc.data) {
          zip.file(fileName, doc.data, { base64: true });
        }
      } catch (err) {
        console.error(`Error fetching document ${fileName} for zip:`, err);
      }
    }
  } else {
    zip.file('nota.txt', 'Expediente sin documentos adjuntos.');
  }

  const base64Zip = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });

  return { base64Zip, blob };
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

/**
 * Compresses any JSON object or string into a ZIP Blob containing a backup.json file
 */
export const compressJsonToZipBlob = async (
  jsonData: any,
  jsonFilename = 'backup.json'
): Promise<Blob> => {
  const zip = new JSZip();
  const jsonStr = typeof jsonData === 'string' ? jsonData : JSON.stringify(jsonData, null, 2);
  zip.file(jsonFilename, jsonStr);
  return await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });
};

/**
 * Compresses JSON into a Base64-encoded ZIP string (for lightweight Firestore document storage)
 */
export const compressJsonToBase64Zip = async (
  jsonData: any,
  jsonFilename = 'backup.json'
): Promise<{ base64Zip: string; originalSize: number; compressedSize: number }> => {
  const zip = new JSZip();
  const jsonStr = typeof jsonData === 'string' ? jsonData : JSON.stringify(jsonData);
  const originalSize = new Blob([jsonStr]).size;

  zip.file(jsonFilename, jsonStr);
  const base64Zip = await zip.generateAsync({
    type: 'base64',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });

  const compressedSize = new Blob([base64Zip]).size;

  return { base64Zip, originalSize, compressedSize };
};

/**
 * Decompresses a ZIP source (Base64 string, Blob, File, or ArrayBuffer) and parses the JSON file inside
 */
export const decompressZipToJson = async <T = any>(
  zipSource: File | Blob | ArrayBuffer | string
): Promise<T> => {
  const zip = new JSZip();
  let zipContent: JSZip;

  if (typeof zipSource === 'string') {
    zipContent = await zip.loadAsync(zipSource, { base64: true });
  } else {
    zipContent = await zip.loadAsync(zipSource);
  }

  const jsonFileNames = Object.keys(zipContent.files).filter(
    name => name.endsWith('.json') && !zipContent.files[name].dir
  );

  if (jsonFileNames.length === 0) {
    throw new Error('No se encontró ningún archivo .json dentro del archivo ZIP de respaldo.');
  }

  const targetFilename = jsonFileNames.includes('backup.json') ? 'backup.json' : jsonFileNames[0];
  const jsonStr = await zipContent.files[targetFilename].async('string');
  return JSON.parse(jsonStr) as T;
};

/**
 * Reads a File object (either .json or .zip), extracts and returns parsed JSON object
 */
export const readBackupFile = async (
  file: File
): Promise<{ data: any; isCompressed: boolean; fileName: string; originalSize: number }> => {
  const isZip = file.name.toLowerCase().endsWith('.zip') || file.type.includes('zip');
  
  if (isZip) {
    const parsedData = await decompressZipToJson(file);
    return {
      data: parsedData,
      isCompressed: true,
      fileName: file.name,
      originalSize: file.size
    };
  } else {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target?.result as string);
          resolve({
            data: parsed,
            isCompressed: false,
            fileName: file.name,
            originalSize: file.size
          });
        } catch (err: any) {
          reject(new Error(`El archivo JSON no es válido: ${err.message || err}`));
        }
      };
      reader.onerror = () => reject(new Error('Error al leer el archivo de respaldo.'));
      reader.readAsText(file);
    });
  }
};

/**
 * Helper to format byte size nicely
 */
export const formatBytes = (bytes: number, decimals = 2): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};
