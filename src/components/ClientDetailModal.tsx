import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Client, InsuranceRequest, Payment, Claim } from '../types';
import { X, Shield, Calendar, DollarSign, CreditCard, Receipt, Briefcase, CheckCircle2, Clock, AlertCircle, ArrowRight, FileText, Search } from 'lucide-react';
import { format } from 'date-fns';
import { formatDisplayDate } from '../lib/policyUtils';
import { getInsuranceDisplayStatus, getInsuranceFinalPrice } from '../utils/paymentUtils';

interface ClientDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  client: Client | null;
}

export default function ClientDetailModal({ isOpen, onClose, client }: ClientDetailModalProps) {
  const [insurances, setInsurances] = useState<InsuranceRequest[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'insurances' | 'payments' | 'claims' | 'commissions' | 'notes'>('insurances');
  const [searchQuery, setSearchQuery] = useState('');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setStartDateFilter('');
      setEndDateFilter('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !client) return;

    setLoading(true);

    let unsubEmail: (() => void) | null = null;
    let unsubClientId: (() => void) | null = null;
    let unsubPay: (() => void) | null = null;
    let unsubClaims: (() => void) | null = null;

    let emailDocs: InsuranceRequest[] = [];
    let clientIdDocs: InsuranceRequest[] = [];

    const handleInsurancesUpdate = (fromEmail: InsuranceRequest[], fromClientId: InsuranceRequest[]) => {
      // Merge under a map key to avoid any duplication of requests
      const mergedMap = new Map<string, InsuranceRequest>();
      fromEmail.forEach(i => { if (i.id) mergedMap.set(i.id, i); });
      fromClientId.forEach(i => { if (i.id) mergedMap.set(i.id, i); });

      const mergedList = Array.from(mergedMap.values());
      // Sort desc by createdAt or ID comparison fallback
      mergedList.sort((a, b) => {
        const dateA = a.createdAt?.seconds || (a.createdAt instanceof Date ? a.createdAt.getTime() / 1000 : 0);
        const dateB = b.createdAt?.seconds || (b.createdAt instanceof Date ? b.createdAt.getTime() / 1000 : 0);
        if (dateB !== dateA) return dateB - dateA;
        return (b.id || '').localeCompare(a.id || '');
      });

      setInsurances(mergedList);

      // Clean up previous sub-listeners
      if (unsubPay) { unsubPay(); unsubPay = null; }
      if (unsubClaims) { unsubClaims(); unsubClaims = null; }

      if (mergedList.length > 0) {
        const insIds = mergedList.map(i => i.id).filter(Boolean) as string[];

        // Fetch payments for these insurances (limit to first 10 for Firestore 'in' limit)
        const qPay = query(
          collection(db, 'payments'),
          where('insuranceId', 'in', insIds.slice(0, 10)),
          orderBy('date', 'desc')
        );

        // Fetch claims for these insurances (limit to first 10 for Firestore 'in' limit)
        const qClaims = query(
          collection(db, 'claims'),
          where('insuranceId', 'in', insIds.slice(0, 10))
        );

        let payDone = false;
        let claimsDone = false;

        unsubPay = onSnapshot(qPay, (paySnap) => {
          setPayments(paySnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Payment)));
          payDone = true;
          if (claimsDone) setLoading(false);
        }, (error) => {
          handleFirestoreError(error, OperationType.GET, 'payments for client detail');
          payDone = true;
          if (claimsDone) setLoading(false);
        });

        unsubClaims = onSnapshot(qClaims, (claimsSnap) => {
          const claimsData = claimsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Claim));
          // Sort claims in-memory by createdAt (descending)
          claimsData.sort((a, b) => {
            const timeA = a.createdAt?.seconds || (a.createdAt instanceof Date ? a.createdAt.getTime() / 1000 : 0);
            const timeB = b.createdAt?.seconds || (b.createdAt instanceof Date ? b.createdAt.getTime() / 1000 : 0);
            return timeB - timeA;
          });
          setClaims(claimsData);
          claimsDone = true;
          if (payDone) setLoading(false);
        }, (error) => {
          handleFirestoreError(error, OperationType.GET, 'claims for client detail');
          claimsDone = true;
          if (payDone) setLoading(false);
        });
      } else {
        setPayments([]);
        setClaims([]);
        setLoading(false);
      }
    };

    // Subscription 1: Match by email address
    const qEmail = query(
      collection(db, 'insurances'),
      where('email', '==', client.email)
    );
    unsubEmail = onSnapshot(qEmail, (snap) => {
      emailDocs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsuranceRequest));
      handleInsurancesUpdate(emailDocs, clientIdDocs);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'insurances by email for client detail');
      setLoading(false);
    });

    // Subscription 2: Match by unique client ID code
    if (client.id) {
      const qClientId = query(
        collection(db, 'insurances'),
        where('clientId', '==', client.id)
      );
      unsubClientId = onSnapshot(qClientId, (snap) => {
        clientIdDocs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsuranceRequest));
        handleInsurancesUpdate(emailDocs, clientIdDocs);
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'insurances by clientId for client detail');
      });
    } else {
      handleInsurancesUpdate(emailDocs, []);
    }

    return () => {
      if (unsubEmail) unsubEmail();
      if (unsubClientId) unsubClientId();
      if (unsubPay) unsubPay();
      if (unsubClaims) unsubClaims();
    };
  }, [isOpen, client]);

  if (!isOpen || !client) return null;

  const commissionStats = {
    paid: payments.filter(p => p.type === 'agent_commission' && p.status === 'completed')
      .reduce((sum, p) => sum + p.amount, 0),
    pending: payments.filter(p => p.type === 'agent_commission' && p.status === 'pending')
      .reduce((sum, p) => sum + p.amount, 0),
    total: insurances.reduce((sum, i) => sum + (i.agentCommission || 0), 0)
  };

  const filteredInsurances = insurances.filter((ins) => {
    if (searchQuery.trim() !== '') {
      const queryStr = searchQuery.toLowerCase();
      const fullName = `${ins.firstName || ''} ${ins.lastName || ''}`.toLowerCase();
      const policyName = (ins.policyName || '').toLowerCase();
      const origin = (ins.originCountry || '').toLowerCase();
      const dest = (ins.destinationCountry || '').toLowerCase();
      const insId = (ins.id || '').toLowerCase();
      const recNumber = (ins.receiptNumber || '').toLowerCase();
      const rawIDseg = (ins.IDseg || '').toLowerCase();

      if (
        !fullName.includes(queryStr) &&
        !policyName.includes(queryStr) &&
        !origin.includes(queryStr) &&
        !dest.includes(queryStr) &&
        !insId.includes(queryStr) &&
        !recNumber.includes(queryStr) &&
        !rawIDseg.includes(queryStr)
      ) {
        return false;
      }
    }

    if (startDateFilter) {
      if (!ins.startDate || ins.startDate < startDateFilter) {
        return false;
      }
    }

    if (endDateFilter) {
      if (!ins.endDate || ins.endDate > endDateFilter) {
        return false;
      }
    }

    return true;
  });

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-5xl w-full overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-700 p-6 text-white flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white/20 rounded-2xl backdrop-blur-md">
              <Shield className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-2xl font-bold">
                {client.type === 'Individual' ? `${client.firstName} ${client.lastName}` : client.commercialName || client.legalName}
              </h3>
              <p className="text-blue-100 text-sm flex items-center gap-2">
                <span className="font-bold uppercase tracking-wider text-[10px] bg-white/20 px-2 py-0.5 rounded-full">{client.type}</span>
                {client.email}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-full transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 bg-gray-50/50 px-6">
          <button
            onClick={() => setActiveTab('insurances')}
            className={`px-6 py-4 text-sm font-bold transition-all border-b-2 flex items-center gap-2 ${
              activeTab === 'insurances' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            <Shield className="w-4 h-4" />
            Seguros Tramitados
          </button>
          <button
            onClick={() => setActiveTab('payments')}
            className={`px-6 py-4 text-sm font-bold transition-all border-b-2 flex items-center gap-2 ${
              activeTab === 'payments' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            <Receipt className="w-4 h-4" />
            Historial de Pagos
          </button>
          <button
            onClick={() => setActiveTab('claims')}
            className={`px-6 py-4 text-sm font-bold transition-all border-b-2 flex items-center gap-2 ${
              activeTab === 'claims' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            <AlertCircle className="w-4 h-4" />
            Siniestros
          </button>
          {(client.type === 'Agent' || client.type === 'Corporate') && (
            <button
              onClick={() => setActiveTab('commissions')}
              className={`px-6 py-4 text-sm font-bold transition-all border-b-2 flex items-center gap-2 ${
                activeTab === 'commissions' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <Briefcase className="w-4 h-4" />
              Comisiones
            </button>
          )}
          <button
            onClick={() => setActiveTab('notes')}
            className={`px-6 py-4 text-sm font-bold transition-all border-b-2 flex items-center gap-2 ${
              activeTab === 'notes' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            <FileText className="w-4 h-4" />
            Notas
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50/30">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-10 h-10 border-4 border-blue-600/20 border-t-blue-600 rounded-full animate-spin" />
              <p className="text-gray-400 text-sm font-medium">Cargando información...</p>
            </div>
          ) : (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
              {activeTab === 'insurances' && (
                <div className="space-y-6 animate-in fade-in duration-200">
                  {/* Filters Bar */}
                  {insurances.length > 0 && (
                    <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm flex flex-col md:flex-row gap-4 items-end">
                      {/* Search Input */}
                      <div className="flex-1 space-y-1.5 w-full">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-wider block">
                          Buscar Asegurado / Póliza / ID
                        </label>
                        <div className="relative">
                          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                          <input
                            type="text"
                            placeholder="Buscar por nombre, apellido, póliza, país IDseg..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-10 pr-4 py-2.5 bg-gray-50/50 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 w-full"
                          />
                        </div>
                      </div>

                      {/* Start Date */}
                      <div className="w-full md:w-44 space-y-1.5">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-wider block">
                          Fecha Inicio (Desde)
                        </label>
                        <input
                          type="date"
                          value={startDateFilter}
                          onChange={(e) => setStartDateFilter(e.target.value)}
                          className="px-4 py-2 bg-gray-50/50 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 w-full"
                        />
                      </div>

                      {/* End Date */}
                      <div className="w-full md:w-44 space-y-1.5">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-wider block">
                          Fecha Fin (Hasta)
                        </label>
                        <input
                          type="date"
                          value={endDateFilter}
                          onChange={(e) => setEndDateFilter(e.target.value)}
                          className="px-4 py-2 bg-gray-50/50 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 w-full"
                        />
                      </div>

                      {/* Clean Filters */}
                      {(searchQuery || startDateFilter || endDateFilter) && (
                        <button
                          onClick={() => {
                            setSearchQuery('');
                            setStartDateFilter('');
                            setEndDateFilter('');
                          }}
                          className="py-2.5 px-5 bg-red-50 text-red-600 border border-red-100 rounded-2xl text-xs font-black hover:bg-red-100 transition-colors cursor-pointer w-full md:w-auto"
                        >
                          Limpiar
                        </button>
                      )}
                    </div>
                  )}

                  {insurances.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-200">
                      <Shield className="w-12 h-12 text-gray-200 mx-auto mb-4" />
                      <p className="text-gray-400 font-medium">No hay seguros registrados para este cliente.</p>
                    </div>
                  ) : filteredInsurances.length === 0 ? (
                    <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-gray-200 animate-in fade-in duration-200">
                      <Search className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                      <p className="text-gray-500 font-bold text-sm">Sin resultados para los filtros actuales</p>
                      <p className="text-gray-400 text-xs mt-1">Intenta ajustando los términos de búsqueda o el rango de fechas.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4">
                      {filteredInsurances.map((ins) => (
                        <div key={ins.id} className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div className="flex items-start md:items-center gap-4">
                            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl shrink-0">
                              <Shield className="w-6 h-6" />
                            </div>
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="font-bold text-gray-900 text-base">{ins.policyName || 'Póliza sin nombre'}</h4>
                                {ins.IDseg && (
                                  <span className="text-[10px] font-mono font-black text-blue-600 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded">
                                    {ins.IDseg}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-gray-700 font-medium mt-1">
                                Asegurado: <span className="font-bold text-gray-900">{ins.firstName} {ins.lastName}</span> {ins.age && <span className="text-gray-400">({ins.age} años)</span>}
                              </p>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-gray-500 font-medium">
                                <span className="flex items-center gap-1 text-[11px]">
                                  <Calendar className="w-3.5 h-3.5 text-gray-400" />
                                  Vigencia: <span className="font-bold text-gray-700">{ins.startDate} al {ins.endDate}</span>
                                </span>
                                <span className="px-1.5 py-0.5 bg-gray-100/80 text-gray-700 rounded font-black text-[9px] uppercase tracking-wider">
                                  {ins.days} días
                                </span>
                                {ins.originCountry && (
                                  <span className="text-[11px] text-gray-400">
                                    Orig: <span className="font-black text-gray-600">{ins.originCountry}</span>
                                  </span>
                                )}
                                {ins.destinationCountry && (
                                  <span className="text-[11px] text-gray-400">
                                    Dest: <span className="font-black text-gray-600">{ins.destinationCountry}</span>
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-6 justify-between md:justify-end border-t border-gray-50 pt-3 md:border-none md:pt-0">
                            <div className="text-left md:text-right">
                              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Monto Total</p>
                              <p className="text-base font-black text-gray-900">${getInsuranceFinalPrice(ins).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Estado</p>
                              {(() => {
                                const dStatus = getInsuranceDisplayStatus(ins);
                                return (
                                  <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase border ${
                                    dStatus === 'paid' ? 'bg-green-100 text-green-700 border-green-200 animate-pulse' :
                                    dStatus === 'partially_paid' ? 'bg-yellow-105/90 text-yellow-700 border-yellow-200' :
                                    'bg-red-100 text-red-700 border-red-200'
                                  }`}>
                                    {dStatus === 'paid' ? 'Pagado' : dStatus === 'partially_paid' ? 'Parcial' : 'Pendiente'}
                                  </span>
                                );
                              })()}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'payments' && (
                <div className="space-y-4">
                  {payments.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-200">
                      <Receipt className="w-12 h-12 text-gray-200 mx-auto mb-4" />
                      <p className="text-gray-400 font-medium">No hay pagos registrados.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {payments.map((pay) => (
                        <div key={pay.id} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className={`p-2 rounded-xl ${
                              pay.type === 'client_payment' ? 'bg-green-50 text-green-600' :
                              pay.type === 'agent_commission' ? 'bg-indigo-50 text-indigo-600' :
                              'bg-red-50 text-red-600'
                            }`}>
                              {pay.type === 'client_payment' ? <DollarSign className="w-5 h-5" /> :
                               pay.type === 'agent_commission' ? <Briefcase className="w-5 h-5" /> :
                               <Shield className="w-5 h-5" />}
                            </div>
                            <div>
                              <p className="font-bold text-gray-900 text-sm">
                                {pay.type === 'client_payment' ? 'Pago de Cliente' :
                                 pay.type === 'agent_commission' ? 'Comisión' : 'Pago a Proveedor'}
                              </p>
                              <div className="flex items-center gap-3 mt-0.5 text-[10px] text-gray-500">
                                <span className="flex items-center gap-1">
                                  <Calendar className="w-3 h-3" />
                                  {formatDisplayDate(pay.date)}
                                </span>
                                <span className="flex items-center gap-1">
                                  <CreditCard className="w-3 h-3" />
                                  {pay.paymentMethod}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className={`font-black ${
                              pay.type === 'client_payment' ? 'text-green-600' :
                              pay.type === 'agent_commission' ? 'text-indigo-600' :
                              'text-red-600'
                            }`}>
                              ${pay.amount.toLocaleString()} USD
                            </p>
                            <p className="text-[10px] font-bold text-gray-400 uppercase">{pay.status === 'completed' ? 'Completado' : 'Pendiente'}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'commissions' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-green-50 text-green-600 rounded-xl">
                          <CheckCircle2 className="w-5 h-5" />
                        </div>
                        <h5 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Pagadas</h5>
                      </div>
                      <p className="text-3xl font-black text-gray-900">${commissionStats.paid.toLocaleString()} <span className="text-sm font-bold text-gray-400">USD</span></p>
                    </div>
                    <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-yellow-50 text-yellow-600 rounded-xl">
                          <Clock className="w-5 h-5" />
                        </div>
                        <h5 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Por Pagar</h5>
                      </div>
                      <p className="text-3xl font-black text-gray-900">${commissionStats.pending.toLocaleString()} <span className="text-sm font-bold text-gray-400">USD</span></p>
                    </div>
                    <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                          <DollarSign className="w-5 h-5" />
                        </div>
                        <h5 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Generado</h5>
                      </div>
                      <p className="text-3xl font-black text-gray-900">${commissionStats.total.toLocaleString()} <span className="text-sm font-bold text-gray-400">USD</span></p>
                    </div>
                  </div>

                  <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-gray-50 flex justify-between items-center bg-gray-50/30">
                      <h4 className="font-bold text-gray-900">Desglose de Comisiones</h4>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <AlertCircle className="w-4 h-4" />
                        Las comisiones se generan al completar el pago de la póliza
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="bg-gray-50/50 text-[10px] font-black text-gray-400 uppercase tracking-wider">
                            <th className="px-6 py-4">Póliza / Cliente</th>
                            <th className="px-6 py-4">Monto Comisión</th>
                            <th className="px-6 py-4">Estado</th>
                            <th className="px-6 py-4">Fecha</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {insurances.filter(i => i.agentCommission && i.agentCommission > 0).map((ins) => {
                            const commissionPayment = payments.find(p => p.insuranceId === ins.id && p.type === 'agent_commission');
                            return (
                              <tr key={ins.id} className="hover:bg-gray-50/50 transition-colors">
                                <td className="px-6 py-4">
                                  <p className="font-bold text-gray-900 text-sm">{ins.policyName}</p>
                                  <p className="text-xs text-gray-500">{ins.firstName} {ins.lastName}</p>
                                </td>
                                <td className="px-6 py-4 font-bold text-indigo-600">
                                  ${ins.agentCommission?.toLocaleString()} USD
                                </td>
                                <td className="px-6 py-4">
                                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase border ${
                                    commissionPayment?.status === 'completed' ? 'bg-green-100 text-green-700 border-green-200' :
                                    commissionPayment?.status === 'pending' ? 'bg-yellow-100 text-yellow-700 border-yellow-200' :
                                    'bg-gray-100 text-gray-700 border-gray-200'
                                  }`}>
                                    {commissionPayment?.status === 'completed' ? 'Pagada' : 
                                     commissionPayment?.status === 'pending' ? 'Pendiente' : 'No Generada'}
                                  </span>
                                </td>
                                <td className="px-6 py-4 text-xs text-gray-500">
                                  {commissionPayment?.date ? (
                                    formatDisplayDate(commissionPayment.date)
                                  ) : '-'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'claims' && (
                <div className="space-y-4">
                  {/* Stats Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="bg-white p-4.5 rounded-2xl border border-gray-100 shadow-sm flex flex-col gap-1">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Total Siniestros</p>
                      <p className="text-2xl font-black text-gray-900">{claims.length}</p>
                    </div>
                    <div className="bg-white p-4.5 rounded-2xl border border-gray-100 shadow-sm border-l-4 border-l-amber-500 flex flex-col gap-1">
                      <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Siniestros Abiertos</p>
                      <p className="text-2xl font-black text-gray-900">{claims.filter(c => !c.isClosed).length}</p>
                    </div>
                    <div className="bg-white p-4.5 rounded-2xl border border-gray-100 shadow-sm border-l-4 border-l-green-600 flex flex-col gap-1">
                      <p className="text-[10px] font-black text-green-600 uppercase tracking-widest">Siniestros Cerrados</p>
                      <p className="text-2xl font-black text-gray-900">{claims.filter(c => c.isClosed).length}</p>
                    </div>
                  </div>

                  {claims.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-200">
                      <AlertCircle className="w-12 h-12 text-gray-200 mx-auto mb-4" />
                      <p className="text-gray-400 font-medium font-sans">No hay siniestros registrados para este cliente.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {claims.map((claim) => {
                        const ins = insurances.find(i => i.id === claim.insuranceId);
                        return (
                          <div
                            key={claim.id}
                            className="bg-white p-5 rounded-2xl border border-gray-100 hover:shadow-md transition-all flex flex-col justify-between gap-4"
                          >
                            <div>
                              <div className="flex justify-between items-center mb-3">
                                {claim.isClosed ? (
                                  <span className="flex items-center gap-1.5 px-2.5 py-0.5 bg-green-50 text-green-700 text-[10px] font-black rounded-full border border-green-100">
                                    <CheckCircle2 className="w-3 h-3" />
                                    CERRADO
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1.5 px-2.5 py-0.5 bg-amber-50 text-amber-700 text-[10px] font-black rounded-full border border-amber-100">
                                    <Clock className="w-3 h-3" />
                                    ABIERTO
                                  </span>
                                )}
                                <span className="text-[10px] text-gray-400 font-mono">#{claim.id?.substring(0, 8)}</span>
                              </div>

                              <h4 className="font-bold text-gray-900 text-sm mb-1">{ins?.policyName || 'Póliza sin especificar'}</h4>
                              
                              <div className="space-y-1 mb-2">
                                {claim.reference && (
                                  <p className="text-xs font-bold text-rose-600 flex items-center gap-1">
                                    <span className="text-[10px] text-gray-400 font-black uppercase">Ref (EN):</span>
                                    <span>{claim.reference}</span>
                                  </p>
                                )}
                                {claim.claimAmount !== undefined && claim.claimAmount !== null && (
                                  <p className="text-xs font-bold text-emerald-700 flex items-center gap-1">
                                    <span className="text-[10px] text-gray-400 font-black uppercase">Reclamo:</span>
                                    <span>${Number(claim.claimAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                                  </p>
                                )}
                              </div>

                              <p className="text-xs text-gray-500 font-medium line-clamp-3 leading-relaxed mb-3">
                                {claim.description}
                              </p>

                              {claim.insurerResponse && (
                                <div className="text-xs bg-slate-50 p-3 rounded-xl border border-slate-100 text-slate-600 mb-1">
                                  <span className="font-bold block text-slate-800 text-[10px] uppercase tracking-wide mb-0.5">Respuesta de Aseguradora:</span>
                                  {claim.insurerResponse}
                                </div>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-gray-50 text-[10px] text-gray-400 font-bold uppercase">
                              <div className="flex items-center gap-3">
                                <span className="flex items-center gap-1">
                                  <Calendar className="w-3 h-3" />
                                  {claim.date}
                                </span>
                                <span className="flex items-center gap-1">
                                  <FileText className="w-3 h-3" />
                                  {claim.documents?.length || 0} Docs
                                </span>
                              </div>

                              {claim.documents && claim.documents.length > 0 && (
                                <div className="flex gap-1.5 overflow-x-auto py-1 max-w-full">
                                  {claim.documents.map((doc, dIdx) => (
                                    <a
                                      key={dIdx}
                                      href={doc.url}
                                      target="_blank"
                                      rel="no-referrer"
                                      referrerPolicy="no-referrer"
                                      className="px-2 py-0.5 bg-blue-50 text-blue-600 border border-blue-100 rounded hover:bg-blue-100 transition-colors flex items-center gap-1 text-[9px] font-bold"
                                    >
                                      Doc {dIdx + 1}
                                    </a>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'notes' && (
                <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm min-h-[300px]">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                      <FileText className="w-5 h-5" />
                    </div>
                    <h4 className="font-bold text-gray-900">Notas del Cliente</h4>
                  </div>
                  {client.notes ? (
                    <div className="prose prose-sm max-w-none text-gray-600 whitespace-pre-wrap bg-gray-50 p-6 rounded-2xl border border-gray-100 italic">
                      {client.notes}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                      <AlertCircle className="w-12 h-12 mb-4 opacity-20" />
                      <p className="font-medium italic">No hay notas registradas para este cliente.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 bg-gray-50 border-t border-gray-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-10 py-3 bg-white border border-gray-200 text-gray-700 font-bold rounded-2xl hover:bg-gray-100 transition-all shadow-sm"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
