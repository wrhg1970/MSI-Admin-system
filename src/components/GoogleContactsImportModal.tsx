import React, { useState, useEffect, useMemo } from 'react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { X, Search, Loader2, CheckSquare, Square, Check, RefreshCw, AlertCircle, Sparkles, UserPlus } from 'lucide-react';
import { Client } from '../types';

interface GoogleContact {
  resourceName: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  avatarUrl?: string;
}

interface GoogleContactsImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: () => void;
}

// In-memory token storage (as required by security guidelines)
let cachedContactsToken: string | null = null;

export default function GoogleContactsImportModal({
  isOpen,
  onClose,
  onImportSuccess
}: GoogleContactsImportModalProps) {
  const [loading, setLoading] = useState(false);
  const [contacts, setContacts] = useState<GoogleContact[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<GoogleContact[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);
  const [tokenReady, setTokenReady] = useState(!!cachedContactsToken);

  // Reset local states on close/open
  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
      setError(null);
      setSuccessCount(null);
      setSelectedContacts([]);
    } else {
      setTokenReady(!!cachedContactsToken);
      if (cachedContactsToken) {
        fetchGoogleContacts(cachedContactsToken);
      }
    }
  }, [isOpen]);

  const handleConnectGoogle = async () => {
    setLoading(true);
    setError(null);
    try {
      const provider = new GoogleAuthProvider();
      provider.addScope('https://www.googleapis.com/auth/contacts.readonly');
      provider.addScope('https://www.googleapis.com/auth/userinfo.email');

      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        cachedContactsToken = credential.accessToken;
        setTokenReady(true);
        await fetchGoogleContacts(credential.accessToken);
      } else {
        throw new Error('No se pudo obtener el token de acceso de Google.');
      }
    } catch (err: any) {
      console.error('Error connecting to Google Contacts:', err);
      // Friendly, non-technical error message
      setError('No se pudo conectar con su cuenta de Google. Asegúrese de otorgar el permiso de lectura para sus contactos.');
    } finally {
      setLoading(false);
    }
  };

  const fetchGoogleContacts = async (token: string) => {
    setLoading(true);
    setError(null);
    try {
      // Connect to Google People API
      const url = 'https://people.googleapis.com/v1/people/me/connections' +
        '?personFields=names,emailAddresses,phoneNumbers,photos' +
        '&pageSize=1000';

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Token expired, clear cache
          cachedContactsToken = null;
          setTokenReady(false);
          throw new Error('La sesión de Google ha expirado. Por favor conéctese de nuevo.');
        }
        throw new Error(`Error del servidor: ${response.status}`);
      }

      const data = await response.json();
      const rawConnections = data.connections || [];

      // Map raw connection data to friendly format
      const formattedContacts: GoogleContact[] = rawConnections.map((person: any) => {
        const nameObj = person.names?.[0] || {};
        const displayName = nameObj.displayName || '';
        const givenName = nameObj.givenName || '';
        const familyName = nameObj.familyName || '';

        const primaryEmail = person.emailAddresses?.find((e: any) => e.metadata?.primary)?.value || person.emailAddresses?.[0]?.value || '';
        const primaryPhone = person.phoneNumbers?.find((p: any) => p.metadata?.primary)?.value || person.phoneNumbers?.[0]?.value || '';
        
        const avatarUrl = person.photos?.find((p: any) => p.metadata?.primary)?.url || person.photos?.[0]?.url || '';

        return {
          resourceName: person.resourceName,
          name: displayName || `${givenName} ${familyName}`.trim() || 'Sin Nombre',
          firstName: givenName || displayName || 'Contacto',
          lastName: familyName || '',
          email: primaryEmail,
          phone: primaryPhone,
          avatarUrl: avatarUrl && !avatarUrl.includes('placeholder') ? avatarUrl : undefined
        };
      }).filter((c: GoogleContact) => c.name !== 'Sin Nombre' && (c.email || c.phone)); // filter out blank placeholders

      // Sort alphabetically
      formattedContacts.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));

      setContacts(formattedContacts);
    } catch (err: any) {
      console.error('Error fetching contacts:', err);
      setError(err.message || 'No se pudieron descargar los contactos de Google.');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleSelect = (contact: GoogleContact) => {
    setSelectedContacts(prev => {
      const exists = prev.find(c => c.resourceName === contact.resourceName);
      if (exists) {
        return prev.filter(c => c.resourceName !== contact.resourceName);
      } else {
        return [...prev, contact];
      }
    });
  };

  const handleSelectAll = (filteredContacts: GoogleContact[]) => {
    setSelectedContacts(filteredContacts);
  };

  const handleSelectNone = () => {
    setSelectedContacts([]);
  };

  const handleImportSelected = async () => {
    if (selectedContacts.length === 0) return;
    setLoading(true);
    setError(null);
    setSuccessCount(null);

    try {
      const clientsRef = collection(db, 'clients');
      let successCountTemp = 0;

      for (const contact of selectedContacts) {
        const clientData: Client = {
          type: 'Individual',
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email.toLowerCase(),
          phone: contact.phone,
          address: '',
          city: '',
          state: '',
          zip: '',
          country: 'MX', // Default
          rfc: '',
          notes: 'Cliente importado desde Google Contacts.',
          createdAt: serverTimestamp()
        };

        await addDoc(clientsRef, clientData);
        successCountTemp++;
      }

      setSuccessCount(successCountTemp);
      onImportSuccess();
      setSelectedContacts([]);
    } catch (err: any) {
      console.error('Error importing clients:', err);
      setError('Ocurrió un error al registrar los contactos seleccionados como clientes.');
    } finally {
      setLoading(false);
    }
  };

  // Filter contacts by search terms
  const filteredContactsList = useMemo(() => {
    if (!searchTerm) return contacts;
    const lowerSearch = searchTerm.toLowerCase();
    return contacts.filter(c => 
      c.name.toLowerCase().includes(lowerSearch) || 
      c.email.toLowerCase().includes(lowerSearch) || 
      c.phone.toLowerCase().includes(lowerSearch)
    );
  }, [contacts, searchTerm]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-[9000] p-4 text-left animate-in fade-in duration-250">
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden border border-gray-100 animate-in slide-in-from-bottom-8 duration-300">
        
        {/* Header */}
        <header className="px-6 py-5 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-100 text-blue-600 rounded-xl">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-lg">Importar de Google Contacts</h3>
              <p className="text-xs text-gray-500">Agrega contactos a tu lista de clientes de manera instantánea</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          
          {error && (
            <div className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-650 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="text-xs font-bold text-red-900 uppercase tracking-wide">Error de Operación</p>
                <p className="text-xs text-red-700 leading-relaxed font-medium">{error}</p>
              </div>
            </div>
          )}

          {successCount !== null && (
            <div className="bg-green-50 border border-green-150 p-5 rounded-2xl flex items-center gap-4 text-green-800">
              <div className="p-2 bg-green-100 text-green-600 rounded-full">
                <Check className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-bold text-green-900 text-sm">¡Importación Exitosa!</h4>
                <p className="text-xs text-green-700 mt-1">Se han registrado <span className="font-bold">{successCount}</span> nuevos clientes individuales en el sistema.</p>
              </div>
            </div>
          )}

          {!tokenReady ? (
            /* Google Connection Prompt */
            <div className="py-12 flex flex-col items-center text-center space-y-6">
              <div className="relative">
                <div className="absolute inset-0 bg-blue-100/40 rounded-full blur-xl scale-125 animate-pulse" />
                <div className="relative p-6 bg-blue-50 text-blue-600 rounded-full">
                  <Sparkles className="w-10 h-10 animate-bounce" />
                </div>
              </div>
              <div className="space-y-1.5 max-w-sm">
                <h4 className="font-bold text-gray-900 text-base">Conexión con Google Segura</h4>
                <p className="text-xs text-gray-500 leading-relaxed font-medium">
                  Conecte su cuenta de Google para sincronizar y buscar dentro de su agenda de contactos de Google e importarlos directamente.
                </p>
              </div>
              <button
                onClick={handleConnectGoogle}
                disabled={loading}
                className="gsi-material-button font-black hover:scale-101 active:scale-95 transition-all shadow-md hover:shadow-lg inline-flex"
                style={{ cursor: loading ? 'not-allowed' : 'pointer' }}
              >
                <div className="gsi-material-button-state"></div>
                <div className="gsi-material-button-content-wrapper">
                  <div className="gsi-material-button-icon">
                    <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ display: 'block' }}>
                      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                      <path fill="none" d="M0 0h48v48H0z"></path>
                    </svg>
                  </div>
                  <span className="gsi-material-button-contents font-black uppercase text-xs tracking-wider text-gray-700">
                    {loading ? 'Conectando...' : 'Conectar con Google'}
                  </span>
                </div>
              </button>
            </div>
          ) : (
            /* Contacts List Dashboard */
            <div className="space-y-4">
              
              {/* Search and Action Bar */}
              <div className="flex flex-col sm:flex-row gap-2 justify-between items-stretch sm:items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Buscar contactos por nombre, correo o teléfono..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-xs font-semibold"
                  />
                </div>
                
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => fetchGoogleContacts(cachedContactsToken!)}
                    disabled={loading}
                    className="p-2 border border-gray-250 hover:bg-gray-50 rounded-xl text-gray-500 transition-all flex items-center gap-1 text-[11px] font-bold"
                    title="Sincronizar contactos de nuevo"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                    Sincronizar
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectAll(filteredContactsList)}
                    className="px-3 py-2 border border-gray-250 hover:bg-gray-50 rounded-xl text-gray-600 font-bold text-[11px]"
                  >
                    Marcar Todos
                  </button>
                  <button
                    type="button"
                    onClick={handleSelectNone}
                    className="px-3 py-2 border border-gray-250 hover:bg-gray-50 rounded-xl text-gray-600 font-bold text-[11px]"
                  >
                    Limpiar
                  </button>
                </div>
              </div>

              {/* Counts */}
              <div className="flex justify-between items-center text-[10px] text-gray-400 uppercase font-bold tracking-wider">
                <span>Contactos Disponibles: {filteredContactsList.length}</span>
                <span className="text-blue-600">Seleccionados: {selectedContacts.length}</span>
              </div>

              {/* Table list */}
              <div className="border border-gray-100 rounded-2xl overflow-hidden max-h-[350px] overflow-y-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-gray-50/80 border-b border-gray-100 text-[10px] uppercase font-black text-gray-400 tracking-wider">
                      <th className="px-5 py-3 w-10">Selector</th>
                      <th className="px-5 py-3">Nombre</th>
                      <th className="px-5 py-3">Información de Contacto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {loading && contacts.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-12 text-center text-gray-400">
                          <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-500 mb-2" />
                          <span className="text-xs font-semibold">Cargando tus contactos desde Google...</span>
                        </td>
                      </tr>
                    ) : filteredContactsList.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-12 text-center text-xs font-bold text-gray-400">
                          No se encontraron contactos que coincidan con la búsqueda.
                        </td>
                      </tr>
                    ) : (
                      filteredContactsList.map(contact => {
                        const isSelected = !!selectedContacts.find(c => c.resourceName === contact.resourceName);
                        return (
                          <tr key={contact.resourceName} className={`hover:bg-blue-50/10 transition-colors text-xs ${isSelected ? 'bg-blue-50/20' : ''}`}>
                            <td className="px-5 py-3">
                              <button
                                type="button"
                                onClick={() => handleToggleSelect(contact)}
                                className="transition-transform active:scale-90"
                              >
                                {isSelected ? (
                                  <CheckSquare className="w-4 h-4 text-blue-600 fill-blue-50" />
                                ) : (
                                  <Square className="w-4 h-4 text-gray-300" />
                                )}
                              </button>
                            </td>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2.5">
                                {contact.avatarUrl ? (
                                  <img 
                                    src={contact.avatarUrl} 
                                    alt={contact.name} 
                                    className="w-7 h-7 rounded-full object-cover shadow-xs border border-gray-100" 
                                    referrerPolicy="no-referrer"
                                  />
                                ) : (
                                  <div className="w-7 h-7 bg-blue-100 text-blue-600 rounded-full font-bold flex items-center justify-center text-[10px]">
                                    {contact.name.charAt(0).toUpperCase()}
                                  </div>
                                )}
                                <span className="font-bold text-gray-800">{contact.name}</span>
                              </div>
                            </td>
                            <td className="px-5 py-3 pr-2 font-medium">
                              <div className="space-y-0.5">
                                {contact.email && <p className="text-gray-700">{contact.email}</p>}
                                {contact.phone && <p className="text-gray-400 text-[10px]">{contact.phone}</p>}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {tokenReady && (
          <footer className="px-6 py-4 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
            <span className="text-[10px] text-gray-400 font-extrabold uppercase tracking-wide">
              {selectedContacts.length} contactos marcados para importación
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 rounded-xl text-xs font-extrabold tracking-wide uppercase transition-colors"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={handleImportSelected}
                disabled={loading || selectedContacts.length === 0}
                className="px-5 py-2.5 bg-blue-600 text-white hover:bg-blue-700 rounded-xl text-xs font-extrabold tracking-wide uppercase transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                Importar {selectedContacts.length > 0 && `(${selectedContacts.length})`}
              </button>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
