import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  getDocs, 
  query, 
  where, 
  doc, 
  setDoc, 
  getDoc,
  addDoc,
  serverTimestamp 
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Policy, Client, InsuranceRequest } from '../types';
import { 
  Settings, 
  RefreshCw, 
  CheckCircle, 
  AlertTriangle, 
  ArrowRight, 
  ShoppingBag, 
  User, 
  Calendar, 
  Save, 
  Download,
  AlertCircle,
  FileCheck2,
  Trash2,
  Search,
  ExternalLink,
  Info
} from 'lucide-react';
import ConfirmModal from './ConfirmModal';

interface WooConfig {
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
  mappings: Record<string, string>; // Woo Product ID or Title -> System Policy ID
  defaultStartDate: string;
  defaultDurationDays: number;
  autoSyncEnabled?: boolean;
  syncSchedules?: { time: string; enabled: boolean }[];
}

export default function WooCommerceManager() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [config, setConfig] = useState<WooConfig>({
    storeUrl: '',
    consumerKey: '',
    consumerSecret: '',
    mappings: {},
    defaultStartDate: new Date().toISOString().split('T')[0],
    defaultDurationDays: 30,
    autoSyncEnabled: true,
    syncSchedules: [
      { time: '08:00', enabled: true },
      { time: '18:00', enabled: true }
    ]
  });

  const [syncTab, setSyncTab] = useState<'pending' | 'synced' | 'all'>('pending');
  const [newScheduleTime, setNewScheduleTime] = useState('12:00');

  const [loadingConfig, setLoadingConfig] = useState(true);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [fetchingWooProducts, setFetchingWooProducts] = useState(false);
  const [wooProducts, setWooProducts] = useState<any[]>([]);

  // Sync Parameters and results
  const [orderStatus, setOrderStatus] = useState<string>('any');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [fetchingOrders, setFetchingOrders] = useState(false);
  const [wooOrders, setWooOrders] = useState<any[]>([]);
  const [syncedOrderIds, setSyncedOrderIds] = useState<Set<string>>(new Set());
  
  // Interface management
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'config' | 'sync' | 'mappings'>('sync');
  const [selectedOrders, setSelectedOrders] = useState<Record<string, boolean>>({});
  const [importingOrders, setImportingOrders] = useState(false);
  const [importLogs, setImportLogs] = useState<string[]>([]);
  
  // Custom manual mappings while reviewing orders (override products, customer details, or dates)
  const [customOrderMappings, setCustomOrderMappings] = useState<Record<string, {
    policyId?: string;
    startDate?: string;
    endDate?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    birthDate?: string;
    destinationCountry?: string;
    gender?: 'M' | 'F' | string;
    city?: string;
    totalPrice?: number;
    totalCost?: number;
    priceConfirmed?: boolean;
  }>>({});

  // States for confirmation modal prior to synchronizing
  const [showConfirmSyncModal, setShowConfirmSyncModal] = useState(false);
  const [unconfirmedCount, setUnconfirmedCount] = useState(0);

  const [expandedItemKey, setExpandedItemKey] = useState<string | null>(null);

  useEffect(() => {
    fetchSystemData();
  }, []);

  const filteredWooOrders = useMemo(() => {
    return wooOrders.filter(order => {
      const isAlreadySynced = syncedOrderIds.has(String(order.id));
      if (syncTab === 'pending') return !isAlreadySynced;
      if (syncTab === 'synced') return isAlreadySynced;
      return true;
    });
  }, [wooOrders, syncedOrderIds, syncTab]);

  const fetchSystemData = async () => {
    try {
      setLoadingConfig(true);
      // Fetch system policies for matching
      const policySnap = await getDocs(collection(db, 'policies'));
      const activePolicies = policySnap.docs
        .map(d => ({ id: d.id, ...d.data() } as Policy))
        .filter(p => p.status !== 'archived');
      setPolicies(activePolicies);

      // Fetch saved integration configuration
      const configDoc = await getDoc(doc(db, 'settings', 'woocommerce'));
      if (configDoc.exists()) {
        const savedData = configDoc.data() as Partial<WooConfig>;
        setConfig(prev => ({
          ...prev,
          storeUrl: savedData.storeUrl || '',
          consumerKey: savedData.consumerKey || '',
          consumerSecret: savedData.consumerSecret || '',
          mappings: savedData.mappings || {},
          defaultStartDate: savedData.defaultStartDate || new Date().toISOString().split('T')[0],
          defaultDurationDays: savedData.defaultDurationDays || 30,
          autoSyncEnabled: savedData.autoSyncEnabled !== undefined ? savedData.autoSyncEnabled : true,
          syncSchedules: savedData.syncSchedules || [
            { time: '08:00', enabled: true },
            { time: '18:00', enabled: true }
          ]
        }));
      }

      // Fetch already imported order references to avoid duplicates
      const insuranceSnap = await getDocs(
        query(collection(db, 'insurances'), where('imported', '==', true))
      );
      const ids = new Set<string>();
      insuranceSnap.docs.forEach(doc => {
        const data = doc.data();
        if (data.externalId && data.externalId.startsWith('woocommerce_order_')) {
          const wId = data.externalId.replace('woocommerce_order_', '');
          ids.add(wId);
        }
      });
      setSyncedOrderIds(ids);

    } catch (error) {
      console.error("Error retrieving configuration:", error);
    } finally {
      setLoadingConfig(false);
    }
  };

  // Save Config and mapping values to Firebase Firestore settings collection
  const handleSaveConfig = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    try {
      setSaveStatus('saving');
      await setDoc(doc(db, 'settings', 'woocommerce'), config);
      setSaveStatus('success');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (error) {
      console.error("Error saving credentials:", error);
      setSaveStatus('error');
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/woocommerce/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeUrl: config.storeUrl,
          consumerKey: config.consumerKey,
          consumerSecret: config.consumerSecret
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTestResult({ success: true, message: data.message });
        // Retrieve products if connected successfully
        loadWooProducts();
      } else {
        setTestResult({ success: false, message: data.error || 'Fallo de autenticación.' });
      }
    } catch (error: any) {
      setTestResult({ success: false, message: `Fallo de conexión: ${error.message}` });
    } finally {
      setTestingConnection(false);
    }
  };

  const loadWooProducts = async () => {
    if (!config.storeUrl || !config.consumerKey || !config.consumerSecret) return;
    setFetchingWooProducts(true);
    try {
      const res = await fetch('/api/woocommerce/fetch-products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeUrl: config.storeUrl,
          consumerKey: config.consumerKey,
          consumerSecret: config.consumerSecret
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setWooProducts(data.products || []);
      }
    } catch (error) {
      console.error("Error loading products:", error);
    } finally {
      setFetchingWooProducts(false);
    }
  };

  // Fetch Woo orders to list and prepare for synchronization
  const handleFetchOrders = async () => {
    if (!config.storeUrl || !config.consumerKey || !config.consumerSecret) {
      setActiveSubTab('config');
      return;
    }
    setFetchingOrders(true);
    try {
      const res = await fetch('/api/woocommerce/fetch-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeUrl: config.storeUrl,
          consumerKey: config.consumerKey,
          consumerSecret: config.consumerSecret,
          status: orderStatus,
          startDate,
          endDate
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const fetched = data.orders || [];
        setWooOrders(fetched);
        
        // Auto-select orders that are NOT yet synchronized and can be mapped
        const initialSelections: Record<string, boolean> = {};
        fetched.forEach((order: any) => {
          const idStr = String(order.id);
          initialSelections[idStr] = !syncedOrderIds.has(idStr);
        });
        setSelectedOrders(initialSelections);
      } else {
        alert(data.error || "No se pudieron recuperar las órdenes.");
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    } finally {
      setFetchingOrders(false);
    }
  };

  // Custom metadata parsing helper to auto-extract date and region fields
  const parseWooMetadata = (order: any, lineItem: any) => {
    const combinedMetaData = [
      ...(order.meta_data || []),
      ...(lineItem.meta_data || [])
    ];

    let extractedStartDate = '';
    let extractedEndDate = '';
    let extractedBirthDate = '';
    let originCountry = '';
    let destinationCountry = '';
    let isExtreme = false;
    let gender = '';
    let city = '';

    // Standard meta_data keys mapping helper
    combinedMetaData.forEach((meta: any) => {
      const key = String(meta.key || '').toLowerCase();
      const val = String(meta.value || '').trim();

      if (key.includes('inicio') || key.includes('start_date') || key.includes('fecha_inicio')) {
        extractedStartDate = val.split(' ')[0]; // clean possible time element
      }
      if (key.includes('fin') || key.includes('end_date') || key.includes('fecha_fin')) {
        extractedEndDate = val.split(' ')[0];
      }
      if (key.includes('nacimiento') || key.includes('birth_date') || key.includes('fecha_nacimiento') || key.includes('birthdate')) {
        extractedBirthDate = val.split(' ')[0];
      }
      if (key.includes('origen') || key.includes('origin')) {
        originCountry = val;
      }
      if (key.includes('destino') || key.includes('destination')) {
        destinationCountry = val;
      }
      if (key.includes('extremo') || key.includes('extreme')) {
        isExtreme = val.toLowerCase() === 'yes' || val.toLowerCase() === 'si' || val === '1' || val.toLowerCase() === 'true';
      }
      if (key.includes('genero') || key.includes('género') || key.includes('gender') || key.includes('sexo') || key.includes('sex')) {
        const lowerVal = val.toLowerCase();
        if (lowerVal.startsWith('m') || lowerVal.includes('masculino') || lowerVal.includes('male') || lowerVal === 'hombre') {
          gender = 'M';
        } else if (lowerVal.startsWith('f') || lowerVal.includes('femenino') || lowerVal.includes('female') || lowerVal === 'mujer') {
          gender = 'F';
        }
      }
      if (key.includes('ciudad') || key.includes('city') || key.includes('location')) {
        city = val;
      }
    });

    // Clean dates to check standard ISO YYYY-MM-DD
    const isoDateReg = /^\d{4}-\d{2}-\d{2}$/;
    if (!isoDateReg.test(extractedStartDate)) extractedStartDate = '';
    if (!isoDateReg.test(extractedEndDate)) extractedEndDate = '';
    if (!isoDateReg.test(extractedBirthDate)) extractedBirthDate = '';

    return {
      startDate: extractedStartDate,
      endDate: extractedEndDate,
      birthDate: extractedBirthDate,
      originCountry: originCountry || order.billing?.country || 'MX',
      destinationCountry: destinationCountry || 'US',
      isExtreme,
      gender,
      city: city || order.billing?.city || ''
    };
  };

  // Handle local parameter mappings for an order line item
  const handleUpdateOrderMapping = (itemKey: string, updates: any) => {
    setCustomOrderMappings(prev => ({
      ...prev,
      [itemKey]: {
        ...prev[itemKey],
        ...updates
      }
    }));
  };

  // Pre-sync check to comply with reconfirmation requirement
  const checkUnconfirmedBeforeSync = () => {
    const ordersToSync = wooOrders.filter(order => selectedOrders[String(order.id)]);
    if (ordersToSync.length === 0) {
      alert("Seleccione al menos una orden para sincronizar.");
      return;
    }

    let count = 0;
    ordersToSync.forEach(order => {
      const orderIdStr = String(order.id);
      order.line_items.forEach((item: any, idx: number) => {
        const itemKey = `${orderIdStr}_${idx}`;
        const customValues = customOrderMappings[itemKey] || {};
        if (!customValues.priceConfirmed) {
          count++;
        }
      });
    });

    if (count > 0) {
      setUnconfirmedCount(count);
      setShowConfirmSyncModal(true);
    } else {
      handlePerformSync();
    }
  };

  // Perform client sync to DB
  const handlePerformSync = async () => {
    const ordersToSync = wooOrders.filter(order => selectedOrders[String(order.id)]);
    if (ordersToSync.length === 0) {
      alert("Seleccione al menos una orden para sincronizar.");
      return;
    }

    setImportingOrders(true);
    setImportLogs([]);
    const logs: string[] = [];

    const addLog = (message: string) => {
      logs.push(`[${new Date().toLocaleTimeString()}] ${message}`);
      setImportLogs([...logs]);
    };

    addLog(`Iniciando sincronización de ${ordersToSync.length} órden(es)...`);

    try {
      for (const order of ordersToSync) {
        const orderIdStr = String(order.id);
        addLog(`Procesando Orden #${order.id} (${order.billing?.first_name} ${order.billing?.last_name})...`);

        // Sync individual products in the order line items
        let itemIndex = -1;
        for (const item of order.line_items) {
          itemIndex++;
          const itemKey = `${orderIdStr}_${itemIndex}`;
          
          // Meta-data parsing
          const extractedMeta = parseWooMetadata(order, item);
          const customValues = customOrderMappings[itemKey] || {};

          // Resolve primary client fields (with fallback to order billing info)
          const firstNameVal = (customValues.firstName || order.billing?.first_name || 'Woo').trim();
          const lastNameVal = (customValues.lastName || order.billing?.last_name || 'Customer').trim();
          const emailVal = (customValues.email || order.billing?.email || '').trim().toLowerCase();
          const birthDateVal = customValues.birthDate || extractedMeta.birthDate || config.defaultStartDate;
          const destinationVal = customValues.destinationCountry || extractedMeta.destinationCountry || 'US';
          const startDateVal = customValues.startDate || extractedMeta.startDate || config.defaultStartDate;
          let endDateVal = customValues.endDate || extractedMeta.endDate;
          const genderVal = customValues.gender || extractedMeta.gender || '';
          const cityVal = customValues.city || extractedMeta.city || order.billing?.city || '';

          if (!emailVal) {
            addLog(`❌ Error: El producto "${item.name}" en la orden #${order.id} no contiene correo de cliente. Se omite.`);
            continue;
          }

          // Identify product policy mapping
          const itemPid = String(item.product_id);
          const mappedPolicyId = customValues.policyId || config.mappings[itemPid] || config.mappings[item.name];

          if (!mappedPolicyId) {
            addLog(`⚠️ Advertencia: El producto "${item.name}" (ID Woo: ${itemPid}) no está mapeado a un plan. Usando el primer plan disponible o default.`);
          }

          const resolvedPolicy = policies.find(p => p.id === mappedPolicyId) || policies[0];
          if (!resolvedPolicy) {
            addLog(`❌ Error: No existen planes de seguro configurados en el sistema.`);
            continue;
          }

          // Check if WooCommerce customer profiles exist in Clients collection in firebase
          const clientQuery = query(collection(db, 'clients'), where('email', '==', emailVal));
          const clientSnap = await getDocs(clientQuery);
          let clientId = '';

          if (!clientSnap.empty) {
            clientId = clientSnap.docs[0].id;
            addLog(`✓ Cliente existente encontrado: ${emailVal} (ID: ${clientId})`);
          } else {
            // Register a new Client document
            addLog(`Creando nuevo perfil de cliente para: ${emailVal}...`);
            const newClientData: Client = {
              type: 'Individual',
              firstName: firstNameVal,
              lastName: lastNameVal,
              email: emailVal,
              phone: order.billing?.phone || '',
              address: order.billing?.address_1 || '',
              city: cityVal,
              state: order.billing?.state || '',
              zip: order.billing?.postcode || '',
              country: order.billing?.country || 'MX',
              rfc: 'XAXX010101000', // default Mexican general public RFC
              birthDate: birthDateVal,
              gender: (genderVal === 'M' || genderVal === 'F') ? genderVal : undefined,
              createdAt: serverTimestamp()
            };

            const clientDocRef = await addDoc(collection(db, 'clients'), newClientData);
            clientId = clientDocRef.id;
            addLog(`✓ Cliente creado con ID: ${clientId}`);
          }

          if (!endDateVal) {
            const start = new Date(startDateVal);
            start.setDate(start.getDate() + config.defaultDurationDays);
            endDateVal = start.toISOString().split('T')[0];
          }

          // Calculate trip duration days
          const datesDiff = new Date(endDateVal).getTime() - new Date(startDateVal).getTime();
          const calculatedDays = Math.max(1, Math.ceil(datesDiff / (1000 * 60 * 60 * 24)));

          const itemTotal = parseFloat(String(item.total || 0));

          // Calculate suggested price and cost
          const suggestedPrice = resolvedPolicy ? (resolvedPolicy.pricePerDay * calculatedDays) : itemTotal;
          const suggestedCost = resolvedPolicy ? ((resolvedPolicy.costPerDay || 1) * calculatedDays) : calculatedDays;

          // Recalculated / confirmed values override
          const finalPrice = customValues.totalPrice !== undefined ? parseFloat(String(customValues.totalPrice)) : suggestedPrice;
          const finalCost = customValues.totalCost !== undefined ? parseFloat(String(customValues.totalCost)) : suggestedCost;

          // Check if custom metadata or calculations can derive ages
          let calculatedAge = 30; // default age representation
          try {
            const birthY = new Date(birthDateVal).getFullYear();
            if (birthY > 1900) {
              calculatedAge = new Date().getFullYear() - birthY;
            }
          } catch (_) {}

          // Consolidating client order insurance payload
          const insuranceRecord: InsuranceRequest = {
            clientType: 'Individual',
            clientId,
            firstName: firstNameVal,
            lastName: lastNameVal,
            email: emailVal,
            birthDate: birthDateVal,
            age: calculatedAge,
            originCountry: extractedMeta.originCountry,
            destinationCountry: destinationVal,
            city: cityVal,
            gender: (genderVal === 'M' || genderVal === 'F') ? genderVal : undefined,
            policyId: resolvedPolicy.id,
            plan: resolvedPolicy.plan,
            policyName: resolvedPolicy.name,
            actionType: 'NEW',
            isExtremeSports: extractedMeta.isExtreme,
            startDate: startDateVal,
            endDate: endDateVal,
            days: calculatedDays,
            totalPrice: finalPrice,
            totalCost: finalCost,
            status: order.status === 'completed' ? 'paid' : 'pending',
            imported: true,
            externalId: `woocommerce_order_${orderIdStr}`,
            createdAt: serverTimestamp()
          };

          addLog(`Importando póliza para plan: "${resolvedPolicy.name}" (${calculatedDays} días)...`);
          const insuranceDoc = await addDoc(collection(db, 'insurances'), insuranceRecord);
          
          // Build associated Payment logs if completed / paid
          if (order.status === 'completed' || order.status === 'processing') {
            const paymentRecord = {
              insuranceId: insuranceDoc.id,
              amount: insuranceRecord.totalPrice,
              currency: 'USD',
              type: 'client_payment',
              status: 'completed',
              date: serverTimestamp(),
              notes: `Pago de pedido WooCommerce #${order.id}. Ref: ${item.name}`,
              receiptNumber: `WOO-#${order.id}`
            };
            await addDoc(collection(db, 'payments'), paymentRecord);
            addLog(`✓ Pago registrado para la póliza.`);
          }
        }

        // Add to processed identifiers
        setSyncedOrderIds(prev => {
          const fresh = new Set(prev);
          fresh.add(orderIdStr);
          return fresh;
        });

        // Clear selection
        setSelectedOrders(prev => {
          const fresh = { ...prev };
          delete fresh[orderIdStr];
          return fresh;
        });

        addLog(`✓ Orden #${order.id} importada con éxito.`);
      }

      addLog("🎉 Sincronización completada con éxito!");
      // Reload mappings to refresh list indices
      fetchSystemData();
    } catch (err: any) {
      addLog(`❌ Error durante el procesamiento: ${err.message}`);
    } finally {
      setImportingOrders(false);
    }
  };

  return (
    <div className="space-y-6" id="woocommerce-dashboard">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-slate-900 text-white p-6 rounded-2xl shadow-xl">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-indigo-600 rounded-xl">
            <ShoppingBag className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
              WooCommerce Integration Engine
              <span className="text-xs font-semibold bg-indigo-500/20 text-indigo-300 px-2.5 py-1 rounded-full border border-indigo-500/30">
                PRO MODULE
              </span>
            </h1>
            <p className="text-xs text-slate-400 mt-1">Conecta múltiples tiendas online, descarga pedidos en tiempo real y gestiona certificados automatizados.</p>
          </div>
        </div>

        <div className="flex gap-2">
          <button 
            onClick={() => setActiveSubTab('sync')} 
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${activeSubTab === 'sync' ? 'bg-white text-slate-900 shadow-md' : 'text-slate-300 hover:bg-slate-800'}`}
          >
            Sincronizar Pedidos
          </button>
          <button 
            onClick={() => setActiveSubTab('mappings')} 
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${activeSubTab === 'mappings' ? 'bg-white text-slate-900 shadow-md' : 'text-slate-300 hover:bg-slate-800'}`}
          >
            Mapeo de Productos
          </button>
          <button 
            onClick={() => setActiveSubTab('config')} 
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${activeSubTab === 'config' ? 'bg-white text-slate-900 shadow-md' : 'text-slate-300 hover:bg-slate-800'}`}
          >
            Ajustes API
          </button>
        </div>
      </div>

      {loadingConfig ? (
        <div className="flex flex-col items-center justify-center p-12 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
          <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-xs text-gray-500 mt-3 font-semibold">Cargando credenciales e historial de integración...</p>
        </div>
      ) : (
        <>
          {/* SubTab 1: API Config */}
          {activeSubTab === 'config' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="lg:col-span-2 space-y-6">
                <form onSubmit={handleSaveConfig} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
                  <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <Settings className="w-5 h-5 text-indigo-600" />
                    Parámetros de conexión WooCommerce REST API v3
                  </h3>
                  
                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Dirección URL de la Tienda (URL pública de WordPress)</label>
                      <input 
                        type="url" 
                        required
                        placeholder="https://mitienda.com"
                        value={config.storeUrl}
                        onChange={e => setConfig({ ...config, storeUrl: e.target.value })}
                        className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
                      />
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Consumer Key (ck_...)</label>
                        <input 
                          type="text" 
                          required
                          placeholder="ck_abc123..."
                          value={config.consumerKey}
                          onChange={e => setConfig({ ...config, consumerKey: e.target.value })}
                          className="w-full px-4 py-3 rounded-xl border border-gray-200 font-mono text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Consumer Secret (cs_...)</label>
                        <input 
                          type="password" 
                          required
                          placeholder="cs_xyz789..."
                          value={config.consumerSecret}
                          onChange={e => setConfig({ ...config, consumerSecret: e.target.value })}
                          className="w-full px-4 py-3 rounded-xl border border-gray-200 font-mono text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
                        />
                      </div>
                    </div>
                  </div>

                  <hr className="border-gray-100" />
                  
                  <h4 className="text-sm font-bold text-gray-800">Parámetros de Respaldo por Omisión</h4>
                  <p className="text-xs text-gray-500">Configura fechas y tiempos globales que se aplicarán si el cliente no define fechas de viaje exactas en su checkout.</p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Fecha de Inicio Predeterminada</label>
                      <input 
                        type="date"
                        value={config.defaultStartDate}
                        onChange={e => setConfig({ ...config, defaultStartDate: e.target.value })}
                        className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Duración predeterminada (Días)</label>
                      <input 
                        type="number"
                        min="1"
                        value={config.defaultDurationDays}
                        onChange={e => setConfig({ ...config, defaultDurationDays: parseInt(e.target.value) || 30 })}
                        className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
                      />
                    </div>
                  </div>

                  <hr className="border-gray-100" />

                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <h4 className="text-sm font-bold text-gray-800">Sincronización Automática Diaria</h4>
                        <p className="text-xs text-gray-500 mt-1">Programa tareas automatizadas para descargar y procesar las órdenes sin intervención manual.</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={!!config.autoSyncEnabled}
                          onChange={e => setConfig({ ...config, autoSyncEnabled: e.target.checked })}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                      </label>
                    </div>

                    {config.autoSyncEnabled && (
                      <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 space-y-3 animate-in fade-in duration-200">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-bold text-slate-700">Horarios Configurados:</span>
                          <button
                            type="button"
                            onClick={() => {
                              setConfig({
                                ...config,
                                syncSchedules: [
                                  { time: '08:00', enabled: true },
                                  { time: '18:00', enabled: true }
                                ]
                              });
                            }}
                            className="text-[10px] bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded font-bold transition-all"
                          >
                            Restablecer Predeterminados (8:00 AM y 6:00 PM)
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {(config.syncSchedules || []).map((sch, sIdx) => {
                            const [hrs, mins] = sch.time.split(':');
                            const hrsInt = parseInt(hrs);
                            const suffix = hrsInt >= 12 ? 'PM' : 'AM';
                            const displayHrs = hrsInt === 0 ? 12 : hrsInt > 12 ? hrsInt - 12 : hrsInt;
                            return (
                              <div key={sIdx} className="flex justify-between items-center bg-white p-2.5 rounded-xl border border-slate-200 text-xs">
                                <span className="font-mono font-bold text-slate-700">
                                  {sch.time} hrs ({displayHrs}:{mins} {suffix})
                                </span>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={sch.enabled}
                                    onChange={e => {
                                      const updated = [...(config.syncSchedules || [])];
                                      updated[sIdx].enabled = e.target.checked;
                                      setConfig({ ...config, syncSchedules: updated });
                                    }}
                                    className="rounded border-gray-300 focus:ring-blue-500"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const updated = (config.syncSchedules || []).filter((_, idx) => idx !== sIdx);
                                      setConfig({ ...config, syncSchedules: updated });
                                    }}
                                    className="text-red-500 hover:text-red-750 p-1"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div className="flex items-center gap-2 pt-2 border-t border-slate-200/60">
                          <input 
                            type="time" 
                            value={newScheduleTime}
                            onChange={e => setNewScheduleTime(e.target.value)}
                            className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (!newScheduleTime) return;
                              const exists = (config.syncSchedules || []).some(s => s.time === newScheduleTime);
                              if (exists) {
                                alert("Este horario ya existe.");
                                return;
                              }
                              const updated = [...(config.syncSchedules || []), { time: newScheduleTime, enabled: true }];
                              updated.sort((a, b) => a.time.localeCompare(b.time));
                              setConfig({ ...config, syncSchedules: updated });
                            }}
                            className="bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold px-3 py-1.5 rounded-lg text-xs transition-all"
                          >
                            + Agregar Horario
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleTestConnection}
                      disabled={testingConnection || !config.storeUrl}
                      className="px-5 py-3 rounded-xl text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 flex items-center gap-2 transition-all disabled:opacity-50"
                    >
                      {testingConnection ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      Probar Credenciales
                    </button>

                    <button
                      type="submit"
                      disabled={saveStatus === 'saving'}
                      className="flex-1 px-5 py-3 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 flex items-center justify-center gap-2 shadow-lg shadow-blue-100 transition-all"
                    >
                      <Save className="w-4 h-4" />
                      {saveStatus === 'saving' ? 'Guardando...' : 'Guardar Ajustes'}
                    </button>
                  </div>

                  {saveStatus === 'success' && (
                    <p className="text-xs text-green-600 font-bold bg-green-50 p-3 rounded-lg border border-green-200 animate-in fade-in" id="save-success-msg">
                      ✓ Configuración guardada correctamente en Firestore.
                    </p>
                  )}
                  {saveStatus === 'error' && (
                    <p className="text-xs text-red-600 font-bold bg-red-50 p-3 rounded-lg border border-red-200 animate-in fade-in">
                      ❌ Hubo un error al escribir las credenciales en el servidor.
                    </p>
                  )}
                </form>
              </div>

              <div className="space-y-6">
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
                  <h3 className="font-bold text-gray-900 text-sm">Estado de la Integración</h3>
                  
                  {testResult ? (
                    <div className={`p-4 rounded-xl border text-xs leading-relaxed ${testResult.success ? 'bg-green-50 text-green-800 border-green-200' : 'bg-red-50 text-red-800 border-red-200'}`} id="test-connection-result">
                      <div className="flex items-start gap-2.5">
                        {testResult.success ? <CheckCircle className="w-4 h-4 text-green-600 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />}
                        <div>
                          <p className="font-bold">{testResult.success ? 'Conectado Exitosamente' : 'Error de Conexión'}</p>
                          <p className="mt-1 opacity-90">{testResult.message}</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 text-center">
                      <p className="text-xs text-gray-500 font-medium">Use el botón para verificar que las de claves Woo de lectura/escritura sean válidas.</p>
                    </div>
                  )}

                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-gray-700 uppercase tracking-widest">Requisitos Previos</h4>
                    <ul className="text-xs space-y-2 text-gray-600">
                      <li className="flex gap-2 items-start">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                        <span>WooCommerce configurado sobre protocolo HTTPS (SSL).</span>
                      </li>
                      <li className="flex gap-2 items-start">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                        <span>Generar API Keys con permisos de <strong>Lectura/Escritura</strong> bajo el menú: <i>WooCommerce &gt; Ajustes &gt; Avanzado &gt; REST API</i>.</span>
                      </li>
                      <li className="flex gap-2 items-start">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                        <span>Los planes de WooCommerce deben asociarse en el módulo "Mapeo" para registrar pólizas automáticas.</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SubTab 2: Products mappings */}
          {activeSubTab === 'mappings' && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Mapeo de Productos WooCommerce a Catálogos de Seguros</h3>
                <p className="text-xs text-gray-500 mt-1">
                  Permite ligar productos específicos comprados en tu Tienda WordPress con pólizas estructuradas en MSI, asegurando que los deducibles, precios por día y beneficios concuerden.
                </p>
              </div>

              <div className="flex justify-between items-center gap-4 bg-gray-50 p-4 rounded-xl border border-gray-100">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-700 uppercase">Productos cargados de WooCommerce:</span>
                  <span className="bg-blue-100 text-blue-700 text-xs px-2.5 py-0.5 rounded-full font-bold">
                    {wooProducts.length || 'No sincronizados'}
                  </span>
                </div>
                <button
                  onClick={loadWooProducts}
                  disabled={fetchingWooProducts || !config.storeUrl}
                  className="px-4 py-2 bg-white border border-gray-200 text-xs font-bold rounded-xl shadow-sm text-gray-700 hover:bg-gray-50 transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {fetchingWooProducts ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  Cargar Productos de Tienda
                </button>
              </div>

              {wooProducts.length === 0 ? (
                <div className="p-8 text-center bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                  <Info className="w-8 h-8 text-indigo-400 mx-auto" />
                  <p className="text-xs text-gray-500 font-bold mt-2">No se han recuperado los productos de WooCommerce aún.</p>
                  <p className="text-[11px] text-gray-400 mt-1">Establezca los accesos de API y luego presione "Cargar Productos" para listarlos.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 max-h-[400px] overflow-y-auto pr-2">
                  {wooProducts.map((p) => {
                    const mappedId = config.mappings[p.id] || '';
                    return (
                      <div key={p.id} className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-4 rounded-xl border border-gray-100 hover:bg-slate-50/50 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-slate-100 rounded-lg text-slate-600 font-mono text-xs font-bold">
                            #{p.id}
                          </div>
                          <div>
                            <p className="text-xs font-bold text-gray-800">{p.name}</p>
                            <p className="text-[11px] text-gray-400">Tipo: {p.type} | Precio regular: {p.price_html ? 'Configurado' : `$${p.regular_price || p.price}`}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 w-full md:w-auto">
                          <ArrowRight className="w-4 h-4 text-gray-400 hidden md:block" />
                          <select
                            value={mappedId}
                            onChange={(e) => {
                              const updatedMappings = { ...config.mappings, [p.id]: e.target.value };
                              // Also double-map by name to allow fallbacks
                              updatedMappings[p.name] = e.target.value;
                              setConfig({ ...config, mappings: updatedMappings });
                            }}
                            className="w-full md:w-64 px-3 py-2 text-xs font-bold rounded-lg border border-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                          >
                            <option value="">-- No mapear (Genera Advertencia) --</option>
                            {policies.map((pol) => (
                              <option key={pol.id} value={pol.id}>
                                MSI: [{pol.plan}] - {pol.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => handleSaveConfig()}
                  disabled={saveStatus === 'saving'}
                  className="px-6 py-2.5 bg-blue-600 text-white font-bold rounded-xl text-xs hover:bg-blue-700 shadow-lg shadow-blue-100 hover:shadow-xl transition-all flex items-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  Guardar Configuración de Mapeo
                </button>
              </div>
            </div>
          )}

          {/* SubTab 3: Sync Workspace */}
          {activeSubTab === 'sync' && (
            <div className="space-y-6">
              {/* Filter form */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
                <h3 className="text-md font-bold text-gray-900 flex items-center gap-2">
                  <Search className="w-5 h-5 text-blue-600" />
                  Búsqueda y descarga de pedidos recientes
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">Estado en WooCommerce</label>
                    <select
                      value={orderStatus}
                      onChange={e => setOrderStatus(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    >
                      <option value="any">Cualquier Estado</option>
                      <option value="processing">Procesando (processing)</option>
                      <option value="completed">Completada (completed)</option>
                      <option value="pending">Pago Pendiente (pending)</option>
                      <option value="on-hold">En Espera (on-hold)</option>
                      <option value="cancelled">Cancelada (cancelled)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">Desde (fecha creación)</label>
                    <input 
                      type="date"
                      value={startDate}
                      onChange={e => setStartDate(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">Hasta (fecha creación)</label>
                    <input 
                      type="date"
                      value={endDate}
                      onChange={e => setEndDate(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div className="flex items-end">
                    <button
                      onClick={handleFetchOrders}
                      disabled={fetchingOrders || !config.storeUrl}
                      className="w-full px-5 py-2.5 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 shadow-md shadow-blue-50 transition-all flex items-center justify-center gap-2"
                    >
                      {fetchingOrders ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                      Solicitar Órdenes
                    </button>
                  </div>
                </div>
              </div>

              {/* Logs stream section */}
              {importLogs.length > 0 && (
                <div className="bg-slate-900 text-slate-100 rounded-2xl p-5 shadow-inner border border-slate-800 space-y-3 font-mono text-xs">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                    <span className="text-slate-400 font-bold uppercase tracking-wider">Historial de Sincronización en Directo</span>
                    {importingOrders && <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />}
                  </div>
                  <div className="max-h-[150px] overflow-y-auto space-y-1.5 pr-2">
                    {importLogs.map((log, lIdx) => (
                      <p key={lIdx} className={log.includes('❌') ? 'text-red-400' : log.includes('✓') ? 'text-green-400' : 'text-slate-300'}>
                        {log}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* Sync Table Section */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-gray-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div>
                    <h3 className="font-bold text-gray-900 text-lg">Pedidos devueltos por WooCommerce</h3>
                    <p className="text-xs text-gray-500 mt-1">Revise el mapeo, determine fechas del viaje e inicie el traspaso seguro a la Base de Datos.</p>
                  </div>

                  {wooOrders.length > 0 && (
                    <button
                      onClick={checkUnconfirmedBeforeSync}
                      disabled={importingOrders || Object.values(selectedOrders).filter(Boolean).length === 0}
                      className="px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl text-xs flex items-center gap-2 shadow-lg shadow-green-100 transition-all disabled:opacity-50"
                    >
                      <FileCheck2 className="w-4 h-4" />
                      Procesar seleccionados ({Object.values(selectedOrders).filter(Boolean).length})
                    </button>
                  )}
                </div>

                {/* Subpestañas Sincronizados / Por Sincronizar */}
                <div className="flex border-b border-gray-100 bg-gray-50/40 px-6">
                  <button
                    onClick={() => setSyncTab('pending')}
                    className={`py-3.5 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
                      syncTab === 'pending'
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    <span>Por Sincronizar</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                      syncTab === 'pending' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {wooOrders.filter(o => !syncedOrderIds.has(String(o.id))).length}
                    </span>
                  </button>

                  <button
                    onClick={() => setSyncTab('synced')}
                    className={`py-3.5 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
                      syncTab === 'synced'
                        ? 'border-green-600 text-green-600'
                        : 'border-transparent text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    <span>Sincronizados</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                      syncTab === 'synced' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {wooOrders.filter(o => syncedOrderIds.has(String(o.id))).length}
                    </span>
                  </button>

                  <button
                    onClick={() => setSyncTab('all')}
                    className={`py-3.5 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
                      syncTab === 'all'
                        ? 'border-slate-600 text-slate-800'
                        : 'border-transparent text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    <span>Todos</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                      syncTab === 'all' ? 'bg-slate-200 text-slate-800' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {wooOrders.length}
                    </span>
                  </button>
                </div>

                {filteredWooOrders.length === 0 ? (
                  <div className="p-12 text-center text-gray-500">
                    <ShoppingBag className="w-12 h-12 text-gray-300 mx-auto" />
                    <p className="text-xs font-bold mt-3">No hay pedidos en esta categoría.</p>
                    <p className="text-[11px] text-gray-400 mt-1">
                      {syncTab === 'pending'
                        ? '¡Excelente! Todos los pedidos recuperados de este lote ya han sido sincronizados.'
                        : syncTab === 'synced'
                        ? 'Aún no has sincronizado ningún pedido de este lote.'
                        : 'Asegúrese de conectar la tienda y solicitar órdenes mediante los filtros superiores.'}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-55 mb-2 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-widest bg-gray-50/50">
                          <th className="py-3 px-4 w-12 text-center">
                            <input
                              type="checkbox"
                              checked={filteredWooOrders.length > 0 && filteredWooOrders.every(o => syncedOrderIds.has(String(o.id)) || selectedOrders[String(o.id)])}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                const updated = { ...selectedOrders };
                                filteredWooOrders.forEach(o => {
                                  const idStr = String(o.id);
                                  if (!syncedOrderIds.has(idStr)) {
                                    updated[idStr] = checked;
                                  }
                                });
                                setSelectedOrders(updated);
                              }}
                              className="rounded border-gray-300 focus:ring-blue-500"
                            />
                          </th>
                          <th className="py-3 px-4">Pedido</th>
                          <th className="py-3 px-4">Comprador</th>
                          <th className="py-3 px-4">Producto Comprado / Plan</th>
                          <th className="py-3 px-4">Dates</th>
                          <th className="py-3 px-4 font-mono">Monto</th>
                          <th className="py-3 px-4 text-center">Estado Sincronización</th>
                          <th className="py-3 px-4 text-center">Datos de Viajero</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 text-xs text-gray-600">
                        {filteredWooOrders.map((order) => {
                          const idStr = String(order.id);
                          const isAlreadySynced = syncedOrderIds.has(idStr);
                          const isSelected = !!selectedOrders[idStr];
                          
                          return order.line_items.map((item: any, itemIdx: number) => {
                            const itemKey = `${idStr}_${itemIdx}`;
                            const pMetaData = parseWooMetadata(order, item);
                            const customValues = customOrderMappings[itemKey] || {};
                            
                            // Resolve customized traveller parameters with default fallbacks
                            const firstNameVal = customValues.firstName || order.billing?.first_name || 'Woo';
                            const lastNameVal = customValues.lastName || order.billing?.last_name || 'Customer';
                            const emailVal = customValues.email || order.billing?.email || '';
                            const birthDateVal = customValues.birthDate || pMetaData.birthDate || config.defaultStartDate;
                            const destinationVal = customValues.destinationCountry || pMetaData.destinationCountry || 'US';
                            const genderVal = customValues.gender || pMetaData.gender || '';
                            const cityVal = customValues.city || pMetaData.city || order.billing?.city || '';
                            
                            const currentPlanId = customValues.policyId || config.mappings[item.product_id] || config.mappings[item.name] || '';
                            const startDateVal = customValues.startDate || pMetaData.startDate || config.defaultStartDate;
                            const endDateVal = customValues.endDate || pMetaData.endDate || '';
                            
                            const isExpanded = expandedItemKey === itemKey;
                            
                            // Looking up rich catalog details from WooCommerce products
                            const productDetails = wooProducts.find((p: any) => String(p.id) === String(item.product_id));

                            // Calculate travel days dynamically
                            const start = startDateVal ? new Date(startDateVal) : null;
                            const end = endDateVal ? new Date(endDateVal) : null;
                            let computedDays = 0;
                            if (start && end && !isNaN(start.getTime()) && !isNaN(end.getTime())) {
                              const diffTime = end.getTime() - start.getTime();
                              computedDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
                            } else {
                              computedDays = config.defaultDurationDays;
                            }

                            const selectedPolicy = policies.find(p => p.id === currentPlanId) || policies[0];
                            const suggestedPriceVal = selectedPolicy ? (selectedPolicy.pricePerDay * computedDays) : parseFloat(String(item.total || 0));
                            const suggestedCostVal = selectedPolicy ? ((selectedPolicy.costPerDay || 1) * computedDays) : computedDays;

                            return (
                              <React.Fragment key={itemKey}>
                                <tr className={`hover:bg-slate-50/40 transition-colors ${isAlreadySynced ? 'bg-gray-50/20 text-gray-400' : ''}`}>
                                  {itemIdx === 0 && (
                                    <td className="py-4 px-4 text-center text-center" rowSpan={order.line_items.length}>
                                      {!isAlreadySynced ? (
                                        <input
                                          type="checkbox"
                                          checked={isSelected}
                                          onChange={(e) => {
                                            setSelectedOrders({
                                              ...selectedOrders,
                                              [idStr]: e.target.checked
                                            });
                                          }}
                                          className="rounded border-gray-300 focus:ring-blue-500"
                                        />
                                      ) : (
                                        <CheckCircle className="w-4 h-4 text-green-500 mx-auto" />
                                      )}
                                    </td>
                                  )}

                                  {itemIdx === 0 && (
                                    <td className="py-4 px-4 font-bold" rowSpan={order.line_items.length}>
                                      <div className="flex flex-col">
                                        <span className="text-gray-900 font-bold">#{order.id}</span>
                                        <span className="text-[10px] text-gray-400 font-medium">
                                          {new Date(order.date_created).toLocaleDateString()}
                                        </span>
                                        <span className="text-[9px] mt-1 uppercase font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 w-max">
                                          {order.status}
                                        </span>
                                      </div>
                                    </td>
                                  )}

                                  {itemIdx === 0 && (
                                    <td className="py-4 px-4" rowSpan={order.line_items.length}>
                                      <div className="flex flex-col">
                                        <span className="font-bold text-gray-800">{order.billing?.first_name} {order.billing?.last_name}</span>
                                        <span className="text-xs text-gray-500 font-mono">{order.billing?.email}</span>
                                        {order.billing?.phone && <span className="text-[10px] text-gray-400 font-mono">{order.billing?.phone}</span>}
                                      </div>
                                    </td>
                                  )}

                                  <td className="py-4 px-4">
                                    <div className="flex flex-col gap-1.5 max-w-xs">
                                      <span className="font-semibold text-gray-700">
                                        {item.name}
                                        {productDetails?.sku && (
                                          <span className="ml-1.5 font-mono text-[9px] bg-slate-100 text-slate-500 px-1 py-0.5 rounded">
                                            {productDetails.sku}
                                          </span>
                                        )}
                                      </span>
                                      {!isAlreadySynced ? (
                                        <div className="flex items-center gap-1">
                                          <span className="text-[10px] text-gray-500">
                                            Plan: {policies.find(p => p.id === currentPlanId)?.name || 'Sin plan asignado'}
                                          </span>
                                          {!currentPlanId && (
                                            <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                                          )}
                                        </div>
                                      ) : (
                                        <span className="text-[10px] text-green-700 bg-green-50 px-2 py-0.5 rounded w-max border border-green-100 font-bold">
                                          Mapeado: {policies.find(p => p.id === currentPlanId)?.name || 'Directo'}
                                        </span>
                                      )}
                                    </div>
                                  </td>

                                  <td className="py-4 px-4">
                                    <span className="font-semibold text-gray-500 font-mono">
                                      {startDateVal} a {endDateVal || 'Sin término'}
                                    </span>
                                  </td>

                                  <td className="py-4 px-4 font-bold text-gray-800 font-mono">
                                    ${item.total} {order.currency}
                                  </td>

                                  {itemIdx === 0 && (
                                    <td className="py-4 px-4 text-center text-center" rowSpan={order.line_items.length}>
                                      {isAlreadySynced ? (
                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold text-green-700 bg-green-100 border border-green-200">
                                          Sincronizado
                                        </span>
                                      ) : !currentPlanId ? (
                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold text-amber-700 bg-amber-100 border border-amber-200 animate-pulse">
                                          Falta Plan
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold text-blue-700 bg-blue-100 border border-blue-200">
                                          Listo para Sincronizar
                                        </span>
                                      )}
                                    </td>
                                  )}

                                  <td className="py-4 px-4 text-center">
                                    {!isAlreadySynced ? (
                                      <div className="flex flex-col items-center gap-1.5">
                                        <button
                                          onClick={() => setExpandedItemKey(isExpanded ? null : itemKey)}
                                          className={`px-3 py-1.5 rounded-lg text-[10px] font-extrabold uppercase tracking-wide transition-all ${isExpanded ? 'bg-slate-800 text-white shadow-sm' : customValues.priceConfirmed ? 'bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border border-emerald-200/50' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                                        >
                                          {isExpanded ? 'Cerrar' : customValues.priceConfirmed ? 'Reconfirmado ✎' : 'Confirmar Datos'}
                                        </button>
                                        {customValues.priceConfirmed && (
                                          <span className="text-[9px] text-emerald-600 font-bold flex items-center gap-0.5">
                                            <CheckCircle className="w-2.5 h-2.5 shrink-0" />
                                            ${customValues.totalPrice} | ${customValues.totalCost}
                                          </span>
                                        )}
                                      </div>
                                    ) : (
                                      <span className="text-[10px] font-bold text-gray-400">Verificado</span>
                                    )}
                                  </td>
                                </tr>

                                {isExpanded && !isAlreadySynced && (
                                  <tr className="bg-indigo-50/10">
                                    <td colSpan={8} className="p-4 bg-slate-50/50">
                                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 bg-white p-5 rounded-2xl border border-indigo-100/60 shadow-lg">
                                        
                                        {/* Traveller Details Form */}
                                        <div className="space-y-4">
                                          <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider border-b pb-2 border-slate-100 flex items-center gap-2">
                                            <User className="w-4 h-4 text-indigo-600" />
                                            Confirmar Datos de la Póliza
                                          </h4>
                                          
                                          <div className="grid grid-cols-2 gap-3">
                                            <div>
                                              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Nombre</label>
                                              <input
                                                type="text"
                                                value={firstNameVal}
                                                onChange={(e) => handleUpdateOrderMapping(itemKey, { firstName: e.target.value })}
                                                className="w-full px-3 py-1.5 rounded-lg border border-gray-200 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                                              />
                                            </div>
                                            <div>
                                              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Apellido</label>
                                              <input
                                                type="text"
                                                value={lastNameVal}
                                                onChange={(e) => handleUpdateOrderMapping(itemKey, { lastName: e.target.value })}
                                                className="w-full px-3 py-1.5 rounded-lg border border-gray-200 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                                              />
                                            </div>
                                          </div>

                                          <div className="grid grid-cols-2 gap-3">
                                            <div>
                                              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Correo Electrónico</label>
                                              <input
                                                type="email"
                                                value={emailVal}
                                                onChange={(e) => handleUpdateOrderMapping(itemKey, { email: e.target.value })}
                                                className="w-full px-3 py-1.5 rounded-lg border border-gray-200 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-mono"
                                              />
                                            </div>
                                            <div>
                                              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Fecha de Nacimiento</label>
                                              <input
                                                type="date"
                                                value={birthDateVal}
                                                onChange={(e) => handleUpdateOrderMapping(itemKey, { birthDate: e.target.value })}
                                                className="w-full px-3 py-1.5 rounded-lg border border-gray-200 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-sans"
                                              />
                                            </div>
                                          </div>

                                          <div className="grid grid-cols-2 gap-3">
                                            <div>
                                              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Fecha de Inicio viaje</label>
                                              <input
                                                type="date"
                                                value={startDateVal}
                                                onChange={(e) => handleUpdateOrderMapping(itemKey, { startDate: e.target.value })}
                                                className="w-full px-3 py-1.5 rounded-lg border border-gray-200 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-sans"
                                              />
                                            </div>
                                            <div>
                                              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Fecha de Fin viaje</label>
                                              <input
                                                type="date"
                                                value={endDateVal}
                                                onChange={(e) => handleUpdateOrderMapping(itemKey, { endDate: e.target.value })}
                                                className="w-full px-3 py-1.5 rounded-lg border border-gray-200 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-sans"
                                              />
                                            </div>
                                          </div>

                                          <div className="grid grid-cols-2 gap-3">
                                            <div>
                                              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Destino definitivo</label>
                                              <input
                                                type="text"
                                                placeholder="Ej. España, Estados Unidos"
                                                value={destinationVal}
                                                onChange={(e) => handleUpdateOrderMapping(itemKey, { destinationCountry: e.target.value })}
                                                className="w-full px-3 py-1.5 rounded-lg border border-gray-200 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-sans"
                                              />
                                            </div>
                                            <div>
                                              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Mapeo Plan MSI</label>
                                              <select
                                                value={currentPlanId}
                                                onChange={(e) => handleUpdateOrderMapping(itemKey, { policyId: e.target.value })}
                                                className="w-full px-3 py-1.5 rounded-lg border border-gray-200 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white font-semibold text-slate-800 font-sans"
                                              >
                                                <option value="">-- Mapear plan --</option>
                                                {policies.map(p => (
                                                  <option key={p.id} value={p.id}>MSI: [{p.plan}] - {p.name}</option>
                                                ))}
                                              </select>
                                            </div>
                                          </div>

                                          <div className="grid grid-cols-2 gap-3">
                                            <div>
                                              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Sexo / Género</label>
                                              <select
                                                value={genderVal}
                                                onChange={(e) => handleUpdateOrderMapping(itemKey, { gender: e.target.value })}
                                                className="w-full px-3 py-1.5 rounded-lg border border-gray-200 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white font-sans"
                                              >
                                                <option value="">-- Seleccionar --</option>
                                                <option value="M">Masculino</option>
                                                <option value="F">Femenino</option>
                                              </select>
                                            </div>
                                            <div>
                                              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Ciudad</label>
                                              <input
                                                type="text"
                                                placeholder="Ej. Monterrey, CDMX"
                                                value={cityVal}
                                                onChange={(e) => handleUpdateOrderMapping(itemKey, { city: e.target.value })}
                                                className="w-full px-3 py-1.5 rounded-lg border border-gray-200 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-sans"
                                              />
                                            </div>
                                          </div>
                                        </div>

                                        {/* Rich WooCommerce Catalog Card */}
                                        <div className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-100 flex flex-col justify-between font-sans">
                                          <div>
                                            <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider border-b pb-2 border-slate-200/60 flex items-center gap-2">
                                              <ShoppingBag className="w-4 h-4 text-emerald-600" />
                                              Ficha de Producto en WooCommerce
                                            </h4>

                                            {productDetails ? (
                                              <div className="mt-3 space-y-3">
                                                <div className="flex items-start gap-3">
                                                  {productDetails.images?.[0]?.src ? (
                                                    <img 
                                                      src={productDetails.images[0].src} 
                                                      alt={productDetails.name} 
                                                      className="w-16 h-16 object-cover rounded-lg border border-gray-200 bg-white" 
                                                      referrerPolicy="no-referrer"
                                                    />
                                                  ) : (
                                                    <div className="w-16 h-16 bg-white border border-gray-200 rounded-lg flex items-center justify-center text-gray-400">
                                                      <ShoppingBag className="w-6 h-6 shrink-0 text-gray-300" />
                                                    </div>
                                                  )}
                                                  <div className="space-y-0.5">
                                                    <h5 className="font-bold text-xs text-gray-900 leading-tight">{productDetails.name}</h5>
                                                    <p className="text-[10px] text-gray-500 font-mono">
                                                      <span className="font-semibold text-gray-700 font-sans">ID Producto:</span> {productDetails.id}
                                                    </p>
                                                    <p className="text-[10px] text-gray-500 font-mono">
                                                      <span className="font-semibold text-gray-700 font-sans">SKU:</span> {productDetails.sku || 'N/A'}
                                                    </p>
                                                    <p className="text-[10px] text-gray-500">
                                                      <span className="font-semibold text-gray-700">Estado Inventario:</span>{' '}
                                                      <span className={productDetails.stock_status === 'instock' ? 'text-green-600 font-bold' : 'text-amber-600 font-bold'}>
                                                        {productDetails.stock_status === 'instock' ? 'En Stock' : 'Sin Stock'}
                                                      </span>
                                                    </p>
                                                    {productDetails.categories && (
                                                      <p className="text-[10px] text-gray-500">
                                                        <span className="font-semibold text-gray-700">Categoría:</span> {productDetails.categories.map((c: any) => c.name).join(', ')}
                                                      </p>
                                                    )}
                                                  </div>
                                                </div>

                                                {productDetails.short_description && (
                                                  <div className="text-[11px] text-slate-800 bg-white p-2.5 text-xs rounded-lg border border-slate-200/50 max-h-[85px] overflow-y-auto leading-tight">
                                                    <div dangerouslySetInnerHTML={{ __html: productDetails.short_description }} className="prose prose-xs max-w-none text-slate-500 text-[10.5px]" />
                                                  </div>
                                                )}

                                                <div className="flex items-center gap-2 pt-1 font-sans">
                                                  {productDetails.permalink && (
                                                    <a 
                                                      href={productDetails.permalink} 
                                                      target="_blank" 
                                                      rel="noopener noreferrer" 
                                                      className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 px-2.5 py-1.5 rounded-lg border border-indigo-150/40 transition-colors"
                                                    >
                                                      Ver en WordPress ↗
                                                    </a>
                                                  )}
                                                  <span className="text-[10px] font-mono font-bold text-slate-600 bg-white px-2.5 py-1.5 rounded-lg border border-gray-200">
                                                    Precio tienda: ${productDetails.price || productDetails.regular_price} {order.currency}
                                                  </span>
                                                </div>
                                              </div>
                                            ) : (
                                              <div className="mt-3 space-y-3 font-sans">
                                                <p className="text-[11px] text-slate-500 leading-relaxed font-sans">
                                                  No hay información ampliada disponible en esta sesión para el ID #{item.product_id}.
                                                </p>
                                                <button
                                                  onClick={loadWooProducts}
                                                  disabled={fetchingWooProducts || !config.storeUrl}
                                                  className="w-full py-2 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 text-indigo-700 text-[10.5px] font-bold rounded-lg transition-all"
                                                >
                                                  Cargar catálogo completo para enriquecer fichas ↗
                                                </button>
                                              </div>
                                            )}
                                          </div>

                                          <div className="pt-2 text-[10px] text-gray-400 border-t border-slate-200 flex items-center gap-1 font-sans">
                                            <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                            <span>Los datos mostrados se transferirán de inmediato al sincronizar esta orden.</span>
                                          </div>
                                        </div>

                                        {/* Financial Recalculate & Reconfirm widget */}
                                        <div className="col-span-1 lg:col-span-2 bg-indigo-50/40 border border-indigo-100 rounded-2xl p-4 space-y-3 font-sans mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-indigo-100 pb-2.5 gap-2">
                                            <div className="flex items-center gap-2">
                                              <RefreshCw className="w-4 h-4 text-indigo-600 shrink-0 animate-spin" style={{ animationDuration: '4s' }} />
                                              <h5 className="text-xs font-black text-indigo-950 uppercase tracking-wider">
                                                Recálculo y Reconfirmación Financiera
                                              </h5>
                                            </div>
                                            {customValues.priceConfirmed ? (
                                              <span className="bg-emerald-100 border border-emerald-200 text-emerald-800 text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full flex items-center gap-1">
                                                <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                                                Valores Confirmados
                                              </span>
                                            ) : (
                                              <span className="bg-amber-100 border border-amber-200 text-amber-800 text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full animate-pulse">
                                                Requiere Confirmar
                                              </span>
                                            )}
                                          </div>

                                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs pt-1.5">
                                            <div className="space-y-1 bg-white p-3 rounded-xl border border-indigo-50/60 shadow-sm">
                                              <p className="font-bold text-gray-400 uppercase text-[9px]">Días de Viaje</p>
                                              <p className="text-sm font-black text-gray-800 font-mono">{computedDays} días</p>
                                              <p className="text-[10px] text-gray-400">({startDateVal} al {endDateVal || 'Sin término'})</p>
                                            </div>

                                            <div className="space-y-1.5 bg-white p-3 rounded-xl border border-indigo-50/60 shadow-sm">
                                              <div className="flex justify-between items-center">
                                                <p className="font-bold text-gray-400 uppercase text-[9px]">Precio a Sincronizar ($)</p>
                                                <span className="text-[9px] text-gray-400 font-mono">Sugerido: ${suggestedPriceVal}</span>
                                              </div>
                                              <div className="flex items-center gap-2">
                                                <span className="text-gray-400 text-xs">$</span>
                                                <input
                                                  type="number"
                                                  step="any"
                                                  value={customValues.totalPrice !== undefined ? customValues.totalPrice : suggestedPriceVal}
                                                  onChange={(e) => {
                                                    const val = parseFloat(e.target.value);
                                                    handleUpdateOrderMapping(itemKey, { 
                                                      totalPrice: isNaN(val) ? undefined : val,
                                                      priceConfirmed: false
                                                    });
                                                  }}
                                                  className="w-full px-2 py-1 rounded border border-gray-200 text-xs text-slate-800 font-mono focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-slate-50 hover:bg-white font-bold"
                                                />
                                                <span className="text-gray-400 text-[10px] font-mono">USD</span>
                                              </div>
                                            </div>

                                            <div className="space-y-1.5 bg-white p-3 rounded-xl border border-indigo-50/60 shadow-sm">
                                              <div className="flex justify-between items-center">
                                                <p className="font-bold text-gray-400 uppercase text-[9px]">Costo de Compra ($)</p>
                                                <span className="text-[9px] text-gray-400 font-mono">Sugerido: ${suggestedCostVal}</span>
                                              </div>
                                              <div className="flex items-center gap-2">
                                                <span className="text-gray-400 text-xs">$</span>
                                                <input
                                                  type="number"
                                                  step="any"
                                                  value={customValues.totalCost !== undefined ? customValues.totalCost : suggestedCostVal}
                                                  onChange={(e) => {
                                                    const val = parseFloat(e.target.value);
                                                    handleUpdateOrderMapping(itemKey, { 
                                                      totalCost: isNaN(val) ? undefined : val,
                                                      priceConfirmed: false
                                                    });
                                                  }}
                                                  className="w-full px-2 py-1 rounded border border-gray-200 text-xs text-slate-800 font-mono focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-slate-50 hover:bg-white font-bold"
                                                />
                                                <span className="text-gray-400 text-[10px] font-mono">USD</span>
                                              </div>
                                            </div>
                                          </div>

                                          <div className="pt-2 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-t border-indigo-150/40 text-[11px] leading-tight text-gray-500">
                                            <p>
                                              Tarifas cargadas de plan: <span className="font-bold text-indigo-950">{selectedPolicy ? selectedPolicy.name : 'Primer plan'}</span>
                                            </p>
                                            <div className="flex gap-2 w-full sm:w-auto">
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  handleUpdateOrderMapping(itemKey, {
                                                    totalPrice: suggestedPriceVal,
                                                    totalCost: suggestedCostVal,
                                                    priceConfirmed: true
                                                  });
                                                }}
                                                className="px-3 py-1.5 text-xs text-sky-700 hover:text-sky-800 hover:bg-sky-50 font-bold rounded-lg transition-colors border border-transparent hover:border-sky-200"
                                              >
                                                Reajustar a sugeridos
                                              </button>

                                              {!customValues.priceConfirmed ? (
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    const finalPrice = customValues.totalPrice !== undefined ? customValues.totalPrice : suggestedPriceVal;
                                                    const finalCost = customValues.totalCost !== undefined ? customValues.totalCost : suggestedCostVal;
                                                    handleUpdateOrderMapping(itemKey, {
                                                      totalPrice: finalPrice,
                                                      totalCost: finalCost,
                                                      priceConfirmed: true
                                                    });
                                                  }}
                                                  className="flex-1 sm:flex-initial px-4 py-1.5 bg-green-600 hover:bg-green-700 hover:shadow shadow-sm text-white text-xs font-extrabold uppercase rounded-lg font-sans transition-all"
                                                >
                                                  Reconfirmar Valores Financieros
                                                </button>
                                              ) : (
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    handleUpdateOrderMapping(itemKey, {
                                                      priceConfirmed: false
                                                    });
                                                  }}
                                                  className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-all"
                                                >
                                                  Ajustar de nuevo
                                                </button>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          });
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <ConfirmModal
        isOpen={showConfirmSyncModal}
        onClose={() => setShowConfirmSyncModal(false)}
        onConfirm={() => {
          setShowConfirmSyncModal(false);
          handlePerformSync();
        }}
        title="Reconfirmación de Valores Financieros"
        message={`Hay ${unconfirmedCount} producto(s) en las órdenes seleccionadas cuyos precios y costos recalculados no han sido reconfirmados manualmente.\n\n¿Desea continuar con la sincronización automática (se usarán los valores mostrados en la confirmación)?`}
        confirmText="Sincronizar de todos modos"
        cancelText="Revisar y Confirmar"
        type="warning"
      />
    </div>
  );
}
