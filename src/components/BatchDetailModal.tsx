import React, { useState, useMemo } from 'react';
import { X, Calendar, Search, Eye, User, Users, Building2, Shield, CalendarCheck } from 'lucide-react';
import { InsuranceRequest } from '../types';

interface BatchDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  batch: { exportDate: string; policies: InsuranceRequest[] } | null;
  clients: any[];
  onViewInsuranceDetail: (ins: InsuranceRequest) => void;
}

export default function BatchDetailModal({
  isOpen,
  onClose,
  batch,
  clients,
  onViewInsuranceDetail,
}: BatchDetailModalProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredPolicies = useMemo(() => {
    if (!batch) return [];
    return batch.policies.filter((ins) => {
      const search = searchTerm.toLowerCase();
      const fullName = `${ins.firstName || ''} ${ins.lastName || ''}`.toLowerCase();
      const origin = (ins.originCountry || '').toLowerCase();
      const dest = (ins.destinationCountry || '').toLowerCase();
      const policyId = (ins.policyId || '').toLowerCase();
      const invoiceNum = (ins.InvoiceCaremed || '').toLowerCase();

      return (
        fullName.includes(search) ||
        origin.includes(search) ||
        dest.includes(search) ||
        policyId.includes(search) ||
        invoiceNum.includes(search)
      );
    });
  }, [batch, searchTerm]);

  if (!isOpen || !batch) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[150] p-4 font-sans">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-250">
        
        {/* Header */}
        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
              <CalendarCheck className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">
                Pólizas Exportadas en Lote
              </h3>
              <p className="text-xs text-gray-500 font-medium">
                Fecha del Lote: <span className="font-bold text-gray-700">{batch.exportDate}</span>
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1 px-1.5 bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-700 rounded-xl transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 flex-1 flex flex-col gap-4 overflow-hidden">
          
          {/* Quick Stats & Search Bar */}
          <div className="flex flex-col sm:flex-row items-center gap-4 justify-between bg-gray-50/30 p-4 rounded-xl border border-gray-100">
            <div className="flex items-center gap-6 text-xs font-semibold text-gray-600">
              <div>
                Total pólizas en lote: <span className="text-indigo-600 font-bold bg-indigo-50 px-2 py-0.5 rounded-lg">{batch.policies.length}</span>
              </div>
              {searchTerm && (
                <div>
                  Coincidencias búsqueda: <span className="text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-lg">{filteredPolicies.length}</span>
                </div>
              )}
            </div>

            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar asegurado, país, ID, invoice..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-8 py-2 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-xs transition-all text-gray-800"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs font-bold"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* List of Policies inside Batch (Grid/Table format) */}
          <div className="flex-1 overflow-auto border border-gray-100 rounded-xl bg-white shadow-inner">
            {filteredPolicies.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-12 text-gray-400 text-xs font-bold gap-2">
                <span>No se encontraron pólizas en este lote con el filtro proporcionado.</span>
              </div>
            ) : (
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 bg-gray-50 border-b border-gray-100 text-[10px] uppercase font-bold text-gray-500 tracking-wider">
                  <tr>
                    <th className="px-5 py-3 ml-2">Asegurado</th>
                    <th className="px-5 py-3">Asociación / Canal</th>
                    <th className="px-5 py-3">Orígon / Destino</th>
                    <th className="px-5 py-3">Plan / Fechas</th>
                    <th className="px-5 py-3">Invoice asignado</th>
                    <th className="px-5 py-3 text-right">Información</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredPolicies.map((i) => {
                    const client = clients.find((c) => c.id === i.clientId);
                    const isIndividual =
                      i.clientType === 'Individual' ||
                      (!i.clientType && (!i.clientId || i.clientId === 'Individual'));

                    const clientLabel = i.clientType === 'Agent' ? 'Agente' : 'Corp';
                    const clientName = client
                      ? client.commercialName ||
                        client.legalName ||
                        `${client.firstName || ''} ${client.lastName || ''}`.trim()
                      : 'N/A';

                    return (
                      <tr key={i.id} className="hover:bg-gray-50/50 transition-all text-gray-700">
                        {/* Name & Birthday */}
                        <td className="px-5 py-4">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-bold text-gray-950 text-xs">
                              {i.firstName} {i.lastName}
                            </span>
                            <span className="text-[10px] text-gray-400 font-medium">
                              Fnacimiento: {i.birthDate || '-'}
                            </span>
                          </div>
                        </td>

                        {/* Agency/Client Type */}
                        <td className="px-5 py-4">
                          {isIndividual ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold text-gray-400 bg-gray-50 border border-gray-200">
                              <User className="w-2.5 h-2.5" /> Individual
                            </span>
                          ) : (
                            <div className="flex flex-col text-[10px] leading-tight">
                              <span className="font-semibold text-indigo-700 flex items-center gap-1">
                                {i.clientType === 'Agent' ? (
                                  <Users className="w-3.5 h-3.5" />
                                ) : (
                                  <Building2 className="w-3.5 h-3.5" />
                                )}
                                {clientLabel}: {clientName}
                              </span>
                            </div>
                          )}
                        </td>

                        {/* Destination */}
                        <td className="px-5 py-4">
                          <div className="flex flex-col leading-none">
                            <span className="font-semibold text-gray-800">
                              {i.destinationCountry || '-'}
                            </span>
                            <span className="text-[9px] text-gray-400 mt-1 font-medium">
                              {i.originCountry || '-'} → {i.city || '-'}
                            </span>
                          </div>
                        </td>

                        {/* Plan & Validity dates */}
                        <td className="px-5 py-4">
                          <div className="flex flex-col gap-0.5 text-[10px]">
                            <span className="font-bold text-indigo-600 uppercase tracking-tighter">
                              {i.plan || 'N/A'}
                            </span>
                            <span className="text-[9px] text-gray-400 font-medium">
                              {i.startDate || '-'} al {i.endDate || '-'}
                            </span>
                          </div>
                        </td>

                        {/* CareMed Invoice Code */}
                        <td className="px-5 py-4">
                          {i.InvoiceCaremed ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-100 shadow-sm">
                              {i.InvoiceCaremed}
                            </span>
                          ) : (
                            <span className="text-[10px] italic text-gray-400 font-medium">
                              No asignado
                            </span>
                          )}
                        </td>

                        {/* Single Policy Detail Button (Read Only) */}
                        <td className="px-5 py-4 text-right">
                          <button
                            onClick={() => onViewInsuranceDetail(i)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-indigo-600 hover:text-white hover:bg-indigo-600 rounded-lg border border-indigo-100 hover:border-indigo-600 transition-all cursor-pointer font-bold text-[10.5px] shadow-sm bg-indigo-50/50"
                            title="Ver detalles completos del afiliado"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            Ver Ficha
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-150 bg-gray-50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-lg hover:shadow-indigo-100 transition-all hover:translate-y-[-1px] cursor-pointer"
          >
            Cerrar Vista Detallada
          </button>
        </div>
      </div>
    </div>
  );
}
