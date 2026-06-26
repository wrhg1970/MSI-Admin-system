import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, addDoc, doc, updateDoc, deleteDoc, orderBy, limit, serverTimestamp, getDocs, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Country, ExchangeRate, UserProfile, CustomRole } from '../types';
import { COUNTRIES } from '../constants';
import { Plus, Trash2, Edit2, Save, X, Globe, DollarSign, History, TrendingUp, AlertCircle, Shield, List, Layers, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import InsuranceTypesManager from './InsuranceTypesManager';
import ActionTypesManager from './ActionTypesManager';
import CategoriesManager from './CategoriesManager';
import SubcategoriesManager from './SubcategoriesManager';
import PolicyLettersManager from './PolicyLettersManager';
import PaymentMethodsManager from './PaymentMethodsManager';
import ConfirmModal from './ConfirmModal';
import { usePermissions } from '../hooks/usePermissions';

export default function CatalogsManager({ profile, rolePermissions }: { profile: UserProfile | null, rolePermissions: CustomRole | null }) {
  const { hasPermission } = usePermissions(profile, rolePermissions);
  const [activeSubTab, setActiveSubTab] = useState<'exchange' | 'countries' | 'insurance-types' | 'action-types' | 'categories' | 'subcategories' | 'payment-methods' | 'letters'>('exchange');
  const [countries, setCountries] = useState<Country[]>([]);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRate[]>([]);
  const [editingCountry, setEditingCountry] = useState<Country | null>(null);
  const [isAddingCountry, setIsAddingCountry] = useState(false);
  const [editingRate, setEditingRate] = useState<ExchangeRate | null>(null);
  const [selectedRates, setSelectedRates] = useState<string[]>([]);
  const [newRate, setNewRate] = useState<string>('');
  const [updating, setUpdating] = useState(false);
  const [syncingCapitals, setSyncingCapitals] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  const isAdmin = profile?.role && ['super_admin', 'director', 'seguros', 'administracion', 'admin'].includes(profile.role);

  const handleSyncCapitals = async () => {
    setSyncingCapitals(true);
    setSyncMessage(null);
    let count = 0;
    try {
      for (const c of countries) {
        const staticCountry = COUNTRIES.find(sc => sc.code === c.code);
        if (staticCountry && staticCountry.capital) {
          await updateDoc(doc(db, 'countries', c.id!), { capital: staticCountry.capital });
          count++;
        } else if (c.code === 'WW') {
          await updateDoc(doc(db, 'countries', c.id!), { capital: 'N/A' });
          count++;
        }
      }
      setSyncMessage(`Se actualizaron las capitales de ${count} países exitosamente.`);
      setTimeout(() => setSyncMessage(null), 5000);
    } catch (error) {
      console.error("Error al sincronizar capitales:", error);
      setSyncMessage("Error al actualizar las capitales.");
    } finally {
      setSyncingCapitals(false);
    }
  };

  useEffect(() => {
    const unsubCountries = onSnapshot(collection(db, 'countries'), (snap) => {
      setCountries(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Country)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'countries');
    });

    const qExchange = query(collection(db, 'exchangeRates'), orderBy('date', 'desc'), limit(30));
    const unsubExchange = onSnapshot(qExchange, (snap) => {
      setExchangeRates(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ExchangeRate)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'exchangeRates');
    });

    return () => {
      unsubCountries();
      unsubExchange();
    };
  }, []);

  // Automatically update existing countries with their Capital if they don't have one
  useEffect(() => {
    if (isAdmin && countries.length > 0) {
      const countriesToUpdate = countries.filter(c => !c.capital);
      if (countriesToUpdate.length > 0) {
        const updateCapitals = async () => {
          for (const c of countriesToUpdate) {
            const staticCountry = COUNTRIES.find(sc => sc.code === c.code);
            if (staticCountry && staticCountry.capital) {
              try {
                await updateDoc(doc(db, 'countries', c.id!), { capital: staticCountry.capital });
                console.log(`Updated country ${c.name} with capital ${staticCountry.capital}`);
              } catch (error: any) {
                if (error?.code === 'not-found' || error?.message?.includes('not found') || error?.message?.includes('No document to update') || error?.message?.includes('not-found')) {
                  console.warn(`Country document ${c.id!} (${c.name}) not found for capital update. It may have been deleted.`);
                } else {
                  console.error(`Error updating capital for ${c.name}:`, error);
                }
              }
            } else if (c.code === 'WW') {
              try {
                await updateDoc(doc(db, 'countries', c.id!), { capital: 'N/A' });
              } catch (error: any) {
                if (error?.code === 'not-found' || error?.message?.includes('not found') || error?.message?.includes('No document to update') || error?.message?.includes('not-found')) {
                  console.warn(`Country document ${c.id!} (WW) not found for capital update. It may have been deleted.`);
                } else {
                  console.error(`Error updating capital for WW:`, error);
                }
              }
            }
          }
        };
        updateCapitals();
      }
    }
  }, [countries, isAdmin]);

  const handleSeedCountries = async () => {
    if (countries.length > 0) return;
    try {
      for (const c of COUNTRIES) {
        // Double check if country already exists by code to prevent duplicates
        const q = query(collection(db, 'countries'), where('code', '==', c.code));
        const snap = await getDocs(q);
        if (snap.empty) {
          await addDoc(collection(db, 'countries'), c);
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'countries');
    }
  };

  const handleSaveCountry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCountry) return;
    try {
      if (editingCountry.id) {
        const { id, ...data } = editingCountry;
        await updateDoc(doc(db, 'countries', id), data);
      } else {
        await addDoc(collection(db, 'countries'), editingCountry);
      }
      setEditingCountry(null);
      setIsAddingCountry(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'countries');
    }
  };

  const handleDeleteCountry = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Eliminar País',
      message: '¿Estás seguro de eliminar este país?',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'countries', id));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `countries/${id}`);
        }
      }
    });
  };

  const handleDeleteRate = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Eliminar Registro',
      message: '¿Estás seguro de eliminar este registro de tipo de cambio?',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'exchangeRates', id));
          setSelectedRates(prev => prev.filter(rid => rid !== id));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `exchangeRates/${id}`);
        }
      }
    });
  };

  const handleDeleteSelectedRates = async () => {
    if (selectedRates.length === 0) return;
    setConfirmModal({
      isOpen: true,
      title: 'Eliminar Seleccionados',
      message: `¿Estás seguro de eliminar los ${selectedRates.length} registros seleccionados?`,
      onConfirm: async () => {
        try {
          for (const id of selectedRates) {
            await deleteDoc(doc(db, 'exchangeRates', id));
          }
          setSelectedRates([]);
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, 'exchangeRates_bulk');
        }
      }
    });
  };

  const handleSaveRate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRate) return;
    try {
      const { id, ...data } = editingRate;
      if (id) {
        await updateDoc(doc(db, 'exchangeRates', id), {
          ...data,
          updatedAt: serverTimestamp()
        });
      }
      setEditingRate(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'exchangeRates');
    }
  };

  const handleUpdateRate = async () => {
    const rateVal = parseFloat(newRate);
    if (isNaN(rateVal) || rateVal <= 0) return;

    setUpdating(true);
    const today = format(new Date(), 'yyyy-MM-dd');

    try {
      // Check if rate for today already exists
      const q = query(collection(db, 'exchangeRates'), where('date', '==', today));
      const snap = await getDocs(q);

      if (!snap.empty) {
        await updateDoc(doc(db, 'exchangeRates', snap.docs[0].id), {
          rate: rateVal,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'exchangeRates'), {
          rate: rateVal,
          date: today,
          createdAt: serverTimestamp()
        });
      }
      setNewRate('');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'exchangeRates');
    } finally {
      setUpdating(false);
    }
  };

  const currentRate = exchangeRates[0];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Catálogos</h1>
        <p className="text-gray-500">Gestión de tipos de cambio y países</p>
      </header>

      <div className="flex gap-4 border-b border-gray-200">
        <button
          onClick={() => setActiveSubTab('exchange')}
          className={`pb-2 px-4 text-sm font-medium transition-all border-b-2 ${
            activeSubTab === 'exchange' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Tipo de Cambio
        </button>
        <button
          onClick={() => setActiveSubTab('countries')}
          className={`pb-2 px-4 text-sm font-medium transition-all border-b-2 ${
            activeSubTab === 'countries' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Países
        </button>
        <button
          onClick={() => setActiveSubTab('insurance-types')}
          className={`pb-2 px-4 text-sm font-medium transition-all border-b-2 ${
            activeSubTab === 'insurance-types' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Tipos de Seguro
        </button>
        <button
          onClick={() => setActiveSubTab('action-types')}
          className={`pb-2 px-4 text-sm font-medium transition-all border-b-2 ${
            activeSubTab === 'action-types' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Tipo de Acción
        </button>
        <button
          onClick={() => setActiveSubTab('categories')}
          className={`pb-2 px-4 text-sm font-medium transition-all border-b-2 ${
            activeSubTab === 'categories' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Categorías
        </button>
        <button
          onClick={() => setActiveSubTab('subcategories')}
          className={`pb-2 px-4 text-sm font-medium transition-all border-b-2 ${
            activeSubTab === 'subcategories' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Subcategorías
        </button>
        <button
          onClick={() => setActiveSubTab('payment-methods')}
          className={`pb-2 px-4 text-sm font-medium transition-all border-b-2 ${
            activeSubTab === 'payment-methods' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Métodos de Pago
        </button>
        <button
          onClick={() => setActiveSubTab('letters')}
          className={`pb-2 px-4 text-sm font-medium transition-all border-b-2 ${
            activeSubTab === 'letters' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Cartas
        </button>
      </div>

      {activeSubTab === 'exchange' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Current Rate Card */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                  <DollarSign className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">Tipo de Cambio Actual</h3>
                  <p className="text-xs text-gray-500">USD vs MXP</p>
                </div>
              </div>

              <div className="text-center py-4">
                <p className="text-4xl font-black text-blue-600">
                  {currentRate ? `$${currentRate.rate.toFixed(2)}` : '---'}
                </p>
                <p className="text-sm text-gray-400 mt-1">
                  {currentRate ? `Actualizado: ${currentRate.date}` : 'Sin datos'}
                </p>
              </div>

              {isAdmin && (
                <div className="mt-8 pt-6 border-t border-gray-50 space-y-4">
                  <h4 className="text-sm font-bold text-gray-700">Actualizar Tasa</h4>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Ej: 17.50"
                      value={newRate}
                      onChange={e => setNewRate(e.target.value)}
                      className="flex-1 p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                    />
                    <button
                      onClick={handleUpdateRate}
                      disabled={updating || !newRate}
                      className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 transition-all disabled:opacity-50"
                    >
                      {updating ? '...' : 'Guardar'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex gap-3">
              <AlertCircle className="w-5 h-5 text-blue-600 shrink-0" />
              <p className="text-xs text-blue-800">
                El tipo de cambio se utiliza para calcular los precios en pesos mexicanos (MXP) en las cotizaciones y emisiones de pólizas.
              </p>
            </div>
          </div>

          {/* History Table */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-6 border-b border-gray-50 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <History className="w-5 h-5 text-gray-400" />
                    <h3 className="font-bold text-gray-900">Histórico de Tasas</h3>
                  </div>
                  {selectedRates.length > 0 && isAdmin && (
                    <button
                      onClick={handleDeleteSelectedRates}
                      className="flex items-center gap-2 text-xs font-bold text-red-600 bg-red-50 px-3 py-1.5 rounded-lg hover:bg-red-100 transition-all border border-red-100"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Borrar Seleccionados ({selectedRates.length})
                    </button>
                  )}
                </div>
                <TrendingUp className="w-5 h-5 text-green-500" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                    <tr>
                      {isAdmin && (
                        <th className="px-6 py-4 font-medium w-10">
                          <input
                            type="checkbox"
                            checked={exchangeRates.length > 0 && selectedRates.length === exchangeRates.length}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedRates(exchangeRates.map(r => r.id!));
                              } else {
                                setSelectedRates([]);
                              }
                            }}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                        </th>
                      )}
                      <th className="px-6 py-4 font-medium">Fecha</th>
                      <th className="px-6 py-4 font-medium">Tasa (USD/MXP)</th>
                      <th className="px-6 py-4 font-medium">Variación</th>
                      {isAdmin && <th className="px-6 py-4 font-medium text-right">Acciones</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {exchangeRates.map((rate, idx) => {
                      const prevRate = exchangeRates[idx + 1];
                      const diff = prevRate ? rate.rate - prevRate.rate : 0;
                      const isSelected = selectedRates.includes(rate.id!);
                      return (
                        <tr key={rate.id} className={`hover:bg-gray-50 transition-colors ${isSelected ? 'bg-blue-50/30' : ''}`}>
                          {isAdmin && (
                            <td className="px-6 py-4">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedRates(prev => [...prev, rate.id!]);
                                  } else {
                                    setSelectedRates(prev => prev.filter(id => id !== rate.id));
                                  }
                                }}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                            </td>
                          )}
                          <td className="px-6 py-4 text-sm text-gray-600">{rate.date}</td>
                          <td className="px-6 py-4 text-sm font-bold text-gray-900">${rate.rate.toFixed(4)}</td>
                          <td className="px-6 py-4 text-sm">
                            {idx < exchangeRates.length - 1 && (
                              <span className={`font-medium ${diff > 0 ? 'text-red-500' : diff < 0 ? 'text-green-500' : 'text-gray-400'}`}>
                                {diff > 0 ? '↑' : diff < 0 ? '↓' : '='} {Math.abs(diff).toFixed(4)}
                              </span>
                            )}
                          </td>
                          {isAdmin && (
                            <td className="px-6 py-4 text-right">
                              <div className="flex justify-end gap-2">
                                <button onClick={() => setEditingRate(rate)} className="text-gray-400 hover:text-blue-600">
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                <button onClick={() => handleDeleteRate(rate.id!)} className="text-gray-400 hover:text-red-600">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {exchangeRates.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-6 py-12 text-center text-gray-400 italic">
                          No hay registros históricos disponibles.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeSubTab === 'countries' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-blue-600" />
              <h3 className="text-lg font-semibold">Gestión de Países</h3>
            </div>
            <div className="flex gap-2">
              {isAdmin && countries.length > 0 && (
                <button
                  onClick={handleSyncCapitals}
                  disabled={syncingCapitals}
                  className="bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  title="Sincronizar capitales de los países existentes desde las constantes"
                >
                  <RefreshCw className={`w-4 h-4 ${syncingCapitals ? 'animate-spin' : ''}`} />
                  {syncingCapitals ? 'Sincronizando...' : 'Sincronizar Capitales'}
                </button>
              )}
              {countries.length === 0 && (
                <button
                  onClick={handleSeedCountries}
                  className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
                >
                  Cargar Países Iniciales
                </button>
              )}
              <button
                onClick={() => {
                  setIsAddingCountry(true);
                  setEditingCountry({ code: '', name: '', region: 1, capital: '' });
                }}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Agregar País
              </button>
            </div>
          </div>

          {syncMessage && (
            <div className={`p-3 text-xs rounded-xl border flex items-center gap-2 ${syncMessage.includes('Error') ? 'bg-red-50 text-red-700 border-red-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}`}>
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{syncMessage}</span>
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-4 font-medium">Codigo</th>
                  <th className="px-6 py-4 font-medium">Nombre</th>
                  <th className="px-6 py-4 font-medium">Capital</th>
                  <th className="px-6 py-4 font-medium">Region</th>
                  <th className="px-6 py-4 font-medium">Idioma</th>
                  <th className="px-6 py-4 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {countries.sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-mono text-gray-600">{c.code}</td>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{c.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{c.capital || '---'}</td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${c.region === 1 ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                        Region {c.region}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{c.language || '---'}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setEditingCountry(c)} className="text-gray-400 hover:text-blue-600">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDeleteCountry(c.id!)} className="text-gray-400 hover:text-red-600">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeSubTab === 'insurance-types' && (
        <InsuranceTypesManager />
      )}

      {activeSubTab === 'action-types' && (
        <ActionTypesManager />
      )}

      {activeSubTab === 'categories' && (
        <CategoriesManager />
      )}

      {activeSubTab === 'subcategories' && (
        <SubcategoriesManager />
      )}

      {activeSubTab === 'payment-methods' && (
        <PaymentMethodsManager />
      )}

      {activeSubTab === 'letters' && (
        <PolicyLettersManager />
      )}

      {/* Rate Editor Modal */}
      {editingRate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-gray-900">Editar Tipo de Cambio</h3>
              <button onClick={() => setEditingRate(null)}><X className="w-6 h-6 text-gray-400" /></button>
            </div>
            <form onSubmit={handleSaveRate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fecha</label>
                <input
                  type="date"
                  required
                  value={editingRate.date}
                  onChange={e => setEditingRate({ ...editingRate, date: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tasa (USD/MXP)</label>
                <input
                  type="number"
                  step="0.0001"
                  required
                  value={editingRate.rate}
                  onChange={e => setEditingRate({ ...editingRate, rate: parseFloat(e.target.value) || 0 })}
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setEditingRate(null)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 shadow-lg flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Country Editor Modal */}
      {editingCountry && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-gray-900">{isAddingCountry ? 'Agregar País' : 'Editar País'}</h3>
              <button onClick={() => { setEditingCountry(null); setIsAddingCountry(false); }}><X className="w-6 h-6 text-gray-400" /></button>
            </div>
            <form onSubmit={handleSaveCountry} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
                <input
                  type="text"
                  required
                  value={editingCountry.name}
                  onChange={e => setEditingCountry({ ...editingCountry, name: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Capital</label>
                <input
                  type="text"
                  placeholder="Ej: Ciudad de México"
                  value={editingCountry.capital || ''}
                  onChange={e => setEditingCountry({ ...editingCountry, capital: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Codigo (ISO)</label>
                  <input
                    type="text"
                    required
                    maxLength={2}
                    value={editingCountry.code}
                    onChange={e => setEditingCountry({ ...editingCountry, code: e.target.value.toUpperCase() })}
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="MX"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Region</label>
                  <select
                    value={editingCountry.region}
                    onChange={e => setEditingCountry({ ...editingCountry, region: parseInt(e.target.value) as 1 | 2 })}
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    <option value={1}>Region 1</option>
                    <option value={2}>Region 2</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Idioma</label>
                <input
                  type="text"
                  placeholder="Ej: Español"
                  value={editingCountry.language || ''}
                  onChange={e => setEditingCountry({ ...editingCountry, language: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => { setEditingCountry(null); setIsAddingCountry(false); }}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 shadow-lg flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
      />
    </div>
  );
}
