import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, onSnapshot, addDoc, updateDoc, setDoc, doc, getDocs, where, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { ExchangeRate } from '../types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { DollarSign, TrendingUp, Plus, Calendar, AlertCircle, X, CheckCircle2, ArrowUpRight, HelpCircle, CreditCard } from 'lucide-react';

export default function DailyExchangeRateWidget() {
  const [latestRate, setLatestRate] = useState<ExchangeRate | null>(null);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [rateInput, setRateInput] = useState('');
  const [cardFeeInput, setCardFeeInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  useEffect(() => {
    // Realtime listener for the latest rate
    const q = query(
      collection(db, 'exchangeRates'),
      orderBy('date', 'desc'),
      limit(1)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        setLatestRate({ id: doc.id, ...doc.data() } as ExchangeRate);
      } else {
        setLatestRate(null);
      }
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'exchangeRates');
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleOpenModal = () => {
    setRateInput(latestRate ? latestRate.rate.toString() : '');
    setCardFeeInput(
      latestRate?.cardFee !== undefined 
        ? latestRate.cardFee.toString() 
        : (latestRate as any)?.cargoTarjeta !== undefined 
        ? (latestRate as any).cargoTarjeta.toString() 
        : '4.5'
    );
    setError(null);
    setIsModalOpen(true);
  };

  const handleAddRate = async (e: React.FormEvent) => {
    e.preventDefault();
    const rateVal = parseFloat(rateInput);
    if (isNaN(rateVal) || rateVal <= 0) {
      setError('Por favor ingrese un tipo de cambio válido mayor a cero.');
      return;
    }

    const cardFeeVal = parseFloat(cardFeeInput);
    if (isNaN(cardFeeVal) || cardFeeVal < 0) {
      setError('Por favor ingrese un cargo de tarjeta válido.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const q = query(collection(db, 'exchangeRates'), where('date', '==', todayStr));
      const snap = await getDocs(q);

      if (!snap.empty) {
        const existingDoc = snap.docs[0];
        await updateDoc(doc(db, 'exchangeRates', existingDoc.id), {
          rate: rateVal,
          cardFee: cardFeeVal,
          cargoTarjeta: cardFeeVal,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'exchangeRates'), {
          rate: rateVal,
          cardFee: cardFeeVal,
          cargoTarjeta: cardFeeVal,
          date: todayStr,
          createdAt: serverTimestamp()
        });
      }

      await setDoc(doc(db, 'settings', 'company'), {
        cardFee: cardFeeVal,
        cargoTarjeta: cardFeeVal
      }, { merge: true });

      setIsModalOpen(false);
      setRateInput('');
      setCardFeeInput('');
    } catch (err: any) {
      console.error('Error adding daily exchange rate:', err);
      setError('Error al registrar la información. Inténtelo de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  const isTodayRegistered = latestRate?.date === todayStr;

  if (loading) {
    return (
      <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm animate-pulse flex flex-col gap-3">
        <div className="h-4 bg-gray-100 rounded w-1/3"></div>
        <div className="h-8 bg-gray-100 rounded w-2/3"></div>
      </div>
    );
  }

  const activeCardFee = latestRate?.cardFee ?? (latestRate as any)?.cargoTarjeta ?? 4.5;

  return (
    <div id="daily-exchange-rate-widget" className="relative overflow-hidden bg-white border border-gray-100 rounded-3xl p-5 shadow-sm hover:shadow-md transition-all duration-300">
      <div className="flex justify-between items-start gap-4">
        <div>
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1">
            Tipo de Cambio Oficial & Recargo
          </span>
          <h4 className="text-sm font-black text-gray-800 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-gray-500" />
            Hoy: {format(new Date(), "dd 'de' MMMM", { locale: es })}
          </h4>
        </div>

        {isTodayRegistered ? (
          <span className="flex items-center gap-1 bg-emerald-50 border border-emerald-100 text-emerald-700 text-[9px] font-black uppercase px-2.5 py-1 rounded-full">
            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            Al día
          </span>
        ) : (
          <span className="flex items-center gap-1 bg-amber-50 border border-amber-100 text-amber-700 text-[9px] font-black uppercase px-2.5 py-1 rounded-full">
            <AlertCircle className="w-3 h-3 text-amber-500" />
            Pendiente
          </span>
        )}
      </div>

      <div className="my-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-baseline gap-2">
          {latestRate ? (
            <>
              <span className="text-3xl font-black text-gray-950 tracking-tight font-mono">
                ${latestRate.rate.toFixed(4)}
              </span>
              <span className="text-xs font-bold text-gray-400">MXN/USD</span>
            </>
          ) : (
            <span className="text-sm font-semibold text-gray-400">Sin datos registrados</span>
          )}
        </div>

        <div className="bg-indigo-50 border border-indigo-100 text-indigo-700 px-3 py-1.5 rounded-xl text-xs font-bold font-mono flex items-center gap-1.5">
          <CreditCard className="w-4 h-4 text-indigo-500" />
          <span>Cargo Tarjeta: {activeCardFee}%</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 pt-3 border-t border-gray-50 text-xs">
        <span className="text-gray-500 flex items-center gap-1">
          {latestRate ? (
            <>
              Último: <strong className="font-bold text-gray-700 font-mono">{latestRate.date}</strong>
            </>
          ) : (
            'Configura el TC del día'
          )}
        </span>

        {!isTodayRegistered ? (
          <button
            onClick={handleOpenModal}
            className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-wider text-[10px] px-3.5 py-2 rounded-xl transition-all cursor-pointer shadow-sm shadow-blue-500/10"
          >
            <Plus className="w-3.5 h-3.5" />
            Registrar TC / Cargo
          </button>
        ) : (
          <button
            onClick={handleOpenModal}
            className="text-gray-400 hover:text-blue-600 font-bold flex items-center gap-1 text-[10px] uppercase tracking-wider transition-colors"
          >
            Actualizar Tasa / Cargo
          </button>
        )}
      </div>

      {/* Decorative ambient path */}
      <div className="absolute -bottom-6 -right-6 w-16 h-16 bg-blue-500/5 rounded-full blur-xl pointer-events-none" />

      {/* Modern Modal Dialog */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm transition-opacity" 
            onClick={() => setIsModalOpen(false)}
          />

          {/* Modal Container */}
          <div className="relative bg-white w-full max-w-md rounded-3xl shadow-xl overflow-hidden border border-gray-100 animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-6 pb-4 border-b border-gray-50 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest block mb-0.5">
                  Catálogo Tipo de Cambio & Cargo Tarjeta
                </span>
                <h3 className="text-lg font-black text-gray-900">
                  {isTodayRegistered ? 'Actualizar Tipo de Cambio' : 'Registrar Tipo de Cambio'}
                </h3>
              </div>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-50 rounded-xl transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content / Form */}
            <form onSubmit={handleAddRate} className="p-6 space-y-4">
              <div className="bg-slate-50 p-4 rounded-2xl border border-gray-100 flex items-center gap-3">
                <div className="p-2.5 bg-blue-100 text-blue-700 rounded-xl">
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Fecha de Registro</span>
                  <strong className="text-xs text-gray-800">
                    {format(new Date(), "dd 'de' MMMM, yyyy", { locale: es })} ({todayStr})
                  </strong>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black text-gray-500 uppercase tracking-wider mb-2">
                    Tasa de cambio (MXN/USD)
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                      <DollarSign className="w-4 h-4 text-gray-400" />
                    </div>
                    <input
                      type="number"
                      step="0.0001"
                      min="0.01"
                      placeholder="Ej: 17.5023"
                      value={rateInput}
                      onChange={(e) => setRateInput(e.target.value)}
                      required
                      disabled={submitting}
                      className="w-full text-sm font-bold pl-9 pr-4 py-3.5 bg-white border border-gray-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black text-gray-500 uppercase tracking-wider mb-2">
                    Cargo Tarjeta (%)
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                      <CreditCard className="w-4 h-4 text-gray-400" />
                    </div>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      placeholder="Ej: 4.5"
                      value={cardFeeInput}
                      onChange={(e) => setCardFeeInput(e.target.value)}
                      required
                      disabled={submitting}
                      className="w-full text-sm font-bold pl-9 pr-4 py-3.5 bg-white border border-gray-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono"
                    />
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                Ingrese la equivalencia de 1 USD en MXN y la tasa de recargo por tarjeta.
              </p>

              {error && (
                <div className="p-3 bg-red-50 text-red-700 text-xs rounded-xl border border-red-100 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Modal Footer */}
              <div className="pt-4 border-t border-gray-50 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={submitting}
                  className="px-5 py-3 text-xs font-bold text-gray-600 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 rounded-2xl transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting || !rateInput}
                  className="px-5 py-3 text-xs font-black uppercase tracking-wider text-white bg-blue-600 hover:bg-blue-700 rounded-2xl shadow-lg shadow-blue-500/15 disabled:opacity-50 transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  {submitting ? 'Guardando...' : 'Guardar Datos'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
