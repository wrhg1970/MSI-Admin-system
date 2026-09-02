import React, { useMemo, useState } from 'react';
import { 
  X, 
  Trash2, 
  AlertTriangle, 
  Eye, 
  User, 
  Calendar, 
  MapPin, 
  CalendarDays, 
  Search, 
  CheckCircle, 
  CheckSquare, 
  Square, 
  ShieldAlert, 
  Layers, 
  Tag, 
  Bookmark,
  Check,
  Filter,
  Sparkles
} from 'lucide-react';
import { InsuranceRequest, Policy } from '../types';
import { formatDisplayDate, findDuplicatePolicyGroups, DuplicateGroup, normalizeDuplicateField } from '../lib/policyUtils';

interface DuplicatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  insurances: InsuranceRequest[];
  policies: Policy[];
  isSuperAdmin?: boolean;
  onViewInsuranceDetail: (insurance: InsuranceRequest) => void;
  onDeleteInsurance: (id: string) => Promise<void>;
  onDeleteMultipleInsurances?: (ids: string[]) => Promise<void>;
}

export default function DuplicatesModal({
  isOpen,
  onClose,
  insurances,
  policies,
  isSuperAdmin = true,
  onViewInsuranceDetail,
  onDeleteInsurance,
  onDeleteMultipleInsurances,
}: DuplicatesModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isDeletingSingle, setIsDeletingSingle] = useState<string | null>(null);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [isDeletingBatch, setIsDeletingBatch] = useState(false);

  // Group insurances and identify duplicates based strictly on:
  // 1. Tipo de acción
  // 2. Nombre Completo
  // 3. Fecha de nacimiento
  // 4. Fecha de inicio
  // 5. Origen
  // 6. Destino
  // 7. Plan
  // 8. Póliza
  const duplicateGroups = useMemo(() => {
    return findDuplicatePolicyGroups(insurances, policies);
  }, [insurances, policies]);

  // Filter groups based on search term
  const filteredGroups = useMemo(() => {
    if (!searchTerm.trim()) return duplicateGroups;
    const cleanSearch = normalizeDuplicateField(searchTerm);
    return duplicateGroups.filter(g => {
      const fullName = normalizeDuplicateField(g.sharedInfo.fullName);
      const actionType = normalizeDuplicateField(g.sharedInfo.actionType);
      const origin = normalizeDuplicateField(g.sharedInfo.originCountry);
      const destination = normalizeDuplicateField(g.sharedInfo.destinationCountry);
      const plan = normalizeDuplicateField(g.sharedInfo.plan);
      const policyName = normalizeDuplicateField(g.sharedInfo.policyName);
      const hasMatchingItem = g.items.some(item => 
        (item.id && item.id.toLowerCase().includes(cleanSearch)) ||
        (item.policyNumber && item.policyNumber.toLowerCase().includes(cleanSearch)) ||
        (item.IDseg && item.IDseg.toLowerCase().includes(cleanSearch))
      );

      return (
        fullName.includes(cleanSearch) ||
        actionType.includes(cleanSearch) ||
        origin.includes(cleanSearch) ||
        destination.includes(cleanSearch) ||
        plan.includes(cleanSearch) ||
        policyName.includes(cleanSearch) ||
        hasMatchingItem
      );
    });
  }, [duplicateGroups, searchTerm]);

  // All duplicate item IDs across all groups
  const allDuplicateItemIds = useMemo(() => {
    const ids: string[] = [];
    duplicateGroups.forEach(g => {
      g.items.forEach(item => {
        if (item.id) ids.push(item.id);
      });
    });
    return ids;
  }, [duplicateGroups]);

  // Suggested duplicate item IDs (all items except the newest/first one in each group)
  const suggestedDuplicateItemIds = useMemo(() => {
    const ids: string[] = [];
    duplicateGroups.forEach(g => {
      // Items are sorted newest first. Leave the 0-th index (newest) and mark the rest for removal
      g.items.slice(1).forEach(item => {
        if (item.id) ids.push(item.id);
      });
    });
    return ids;
  }, [duplicateGroups]);

  const totalDuplicateRecordsCount = useMemo(() => {
    return duplicateGroups.reduce((acc, g) => acc + g.items.length, 0);
  }, [duplicateGroups]);

  if (!isOpen) return null;

  // Single Delete handlers
  const handleDeleteClick = (id: string) => {
    setConfirmDeleteId(id);
  };

  const handleConfirmDeleteSingle = async (id: string) => {
    setIsDeletingSingle(id);
    try {
      await onDeleteInsurance(id);
      setSelectedIds(prev => prev.filter(item => item !== id));
      setConfirmDeleteId(null);
    } catch (err) {
      console.error("Error deleting insurance from duplicates modal:", err);
      alert("Hubo un error al eliminar el registro.");
    } finally {
      setIsDeletingSingle(null);
    }
  };

  // Selection handlers
  const handleToggleSelectId = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleToggleSelectGroup = (group: DuplicateGroup) => {
    const groupItemIds = group.items.map(i => i.id).filter((id): id is string => !!id);
    const allGroupSelected = groupItemIds.every(id => selectedIds.includes(id));

    if (allGroupSelected) {
      // Deselect group
      setSelectedIds(prev => prev.filter(id => !groupItemIds.includes(id)));
    } else {
      // Select all in group
      setSelectedIds(prev => Array.from(new Set([...prev, ...groupItemIds])));
    }
  };

  const handleSelectAll = () => {
    setSelectedIds(allDuplicateItemIds);
  };

  const handleSelectSuggested = () => {
    setSelectedIds(suggestedDuplicateItemIds);
  };

  const handleClearSelection = () => {
    setSelectedIds([]);
  };

  // Batch Delete handler
  const handleConfirmBatchDelete = async () => {
    if (selectedIds.length === 0) return;
    setIsDeletingBatch(true);
    try {
      if (onDeleteMultipleInsurances) {
        await onDeleteMultipleInsurances(selectedIds);
      } else {
        // Fallback: delete one by one
        for (const id of selectedIds) {
          await onDeleteInsurance(id);
        }
      }
      setSelectedIds([]);
      setShowBatchDeleteConfirm(false);
    } catch (err) {
      console.error("Error executing batch deletion of duplicates:", err);
      alert("Hubo un error al eliminar los registros seleccionados.");
    } finally {
      setIsDeletingBatch(false);
    }
  };

  const formatToShow = (dateStr: string | undefined): string => {
    if (!dateStr) return '---';
    const formatted = formatDisplayDate(dateStr);
    return formatted === '-' ? '---' : formatted;
  };

  const getActionBadgeClass = (actionType: string) => {
    const upper = actionType.toUpperCase();
    if (upper === 'NEW') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (upper === 'COR') return 'bg-amber-50 text-amber-700 border-amber-200';
    if (upper === 'EXT') return 'bg-blue-50 text-blue-700 border-blue-200';
    if (upper === 'CAN') return 'bg-rose-50 text-rose-700 border-rose-200';
    return 'bg-gray-50 text-gray-700 border-gray-200';
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[150] flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-gray-100">
        
        {/* Header */}
        <div className="p-5 sm:p-6 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 border-b border-amber-200/70 flex justify-between items-start sm:items-center gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="p-3 bg-amber-500 text-white rounded-2xl shadow-md shrink-0">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-xl font-black text-gray-900 tracking-tight">
                  Pólizas Duplicadas Detectadas
                </h2>
                <span className="bg-amber-600 text-white text-xs font-black px-2.5 py-0.5 rounded-full shadow-sm">
                  {duplicateGroups.length} {duplicateGroups.length === 1 ? 'Grupo' : 'Grupos'}
                </span>
                <span className="bg-orange-100 text-orange-800 text-xs font-bold px-2.5 py-0.5 rounded-full border border-orange-200">
                  {totalDuplicateRecordsCount} Registros
                </span>
              </div>
              <p className="text-xs text-amber-900 font-semibold mt-1">
                Criterios de duplicidad evaluados: <span className="font-bold">Tipo de Acción</span>, <span className="font-bold">Nombre Completo</span>, <span className="font-bold">Fecha de Nacimiento</span>, <span className="font-bold">Fecha de Inicio</span>, <span className="font-bold">Origen</span>, <span className="font-bold">Destino</span>, <span className="font-bold">Plan</span> y <span className="font-bold">Póliza</span>.
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-white/80 rounded-xl transition-all cursor-pointer shrink-0"
            title="Cerrar modal"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Action & Selection Toolbar */}
        <div className="p-4 bg-gray-50 border-b border-gray-200 flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
          <div className="flex flex-wrap items-center gap-2 flex-1">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Buscar asegurado, No. póliza, ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-gray-250 rounded-xl bg-white text-xs font-semibold focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-all outline-none"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Quick Selection Helpers */}
            {isSuperAdmin && duplicateGroups.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={handleSelectSuggested}
                  className="flex items-center gap-1.5 px-3 py-2 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded-xl text-xs font-bold transition-all cursor-pointer border border-amber-200 shadow-2xs"
                  title="Selecciona todos los registros duplicados secundarios en cada grupo manteniendo el más reciente"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-700" />
                  Seleccionar Duplicados Sugeridos
                </button>
                <button
                  type="button"
                  onClick={selectedIds.length === allDuplicateItemIds.length ? handleClearSelection : handleSelectAll}
                  className="px-3 py-2 bg-white hover:bg-gray-100 text-gray-700 border border-gray-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  {selectedIds.length === allDuplicateItemIds.length ? 'Deseleccionar Todo' : 'Seleccionar Todo'}
                </button>
                {selectedIds.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearSelection}
                    className="px-2.5 py-2 text-gray-500 hover:text-gray-800 text-xs font-semibold"
                  >
                    Limpiar ({selectedIds.length})
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Batch Delete Action Button for Super Admin */}
          {isSuperAdmin && (
            <div className="flex items-center justify-end gap-2 shrink-0">
              {selectedIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowBatchDeleteConfirm(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-black rounded-xl shadow-md transition-all cursor-pointer animate-in fade-in active:scale-95"
                >
                  <Trash2 className="w-4 h-4" />
                  Borrar seleccionados ({selectedIds.length})
                </button>
              )}
            </div>
          )}
        </div>

        {/* Content Body: Duplicate Groups */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-slate-50/60">
          {filteredGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mb-4 border border-emerald-200 shadow-sm">
                <CheckCircle className="w-8 h-8" />
              </div>
              <h3 className="text-base font-black text-gray-900">
                {searchTerm ? 'No se encontraron coincidencias' : '¡Excelente! No hay pólizas duplicadas'}
              </h3>
              <p className="text-xs text-gray-500 max-w-md mt-1 font-medium">
                {searchTerm 
                  ? 'Intenta con otro término de búsqueda (nombre, ID o número de póliza).' 
                  : 'Todos los registros cumplen con la unicidad en los 8 campos requeridos.'}
              </p>
            </div>
          ) : (
            filteredGroups.map((group) => {
              const { sharedInfo, items } = group;
              const groupItemIds = items.map(i => i.id).filter((id): id is string => !!id);
              const isGroupFullySelected = groupItemIds.length > 0 && groupItemIds.every(id => selectedIds.includes(id));
              const isGroupPartiallySelected = groupItemIds.some(id => selectedIds.includes(id)) && !isGroupFullySelected;

              return (
                <div 
                  key={group.key} 
                  className="bg-white border border-gray-200/90 rounded-2xl shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden"
                >
                  {/* Group Header Info */}
                  <div className="p-4 bg-gradient-to-r from-amber-50/50 via-slate-50 to-white border-b border-gray-200/80 flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="flex items-start sm:items-center gap-3">
                      {isSuperAdmin && (
                        <button
                          type="button"
                          onClick={() => handleToggleSelectGroup(group)}
                          className="mt-0.5 sm:mt-0 p-1 text-amber-600 hover:text-amber-700 transition-colors cursor-pointer"
                          title={isGroupFullySelected ? "Deseleccionar grupo" : "Seleccionar todo el grupo"}
                        >
                          {isGroupFullySelected ? (
                            <CheckSquare className="w-5 h-5 text-amber-600" />
                          ) : isGroupPartiallySelected ? (
                            <div className="w-5 h-5 border-2 border-amber-600 rounded bg-amber-50 flex items-center justify-center">
                              <div className="w-2.5 h-1 bg-amber-600 rounded-xs" />
                            </div>
                          ) : (
                            <Square className="w-5 h-5 text-gray-400 hover:text-gray-600" />
                          )}
                        </button>
                      )}

                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-2 py-0.5 text-[10px] font-black rounded-lg border uppercase tracking-wider ${getActionBadgeClass(sharedInfo.actionType)}`}>
                          Acción: {sharedInfo.actionType}
                        </span>
                        <div className="flex items-center gap-1.5 font-black text-gray-900 text-sm">
                          <User className="w-4 h-4 text-amber-600" />
                          <span>{sharedInfo.fullName || 'Sin Nombre'}</span>
                        </div>
                        {sharedInfo.birthDate && (
                          <span className="text-[11px] font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-lg border border-gray-200">
                            F. Nac: {formatToShow(sharedInfo.birthDate)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Shared Fields Summary Badges */}
                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      <div className="flex items-center gap-1 bg-blue-50 text-blue-800 font-bold px-2.5 py-1 rounded-lg border border-blue-150">
                        <MapPin className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        <span>{sharedInfo.originCountry || '---'} ➔ {sharedInfo.destinationCountry || '---'}</span>
                      </div>
                      <div className="flex items-center gap-1 bg-purple-50 text-purple-800 font-bold px-2.5 py-1 rounded-lg border border-purple-150">
                        <CalendarDays className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                        <span>Inicio: {formatToShow(sharedInfo.startDate)}</span>
                      </div>
                      <div className="flex items-center gap-1 bg-emerald-50 text-emerald-800 font-bold px-2.5 py-1 rounded-lg border border-emerald-150">
                        <Bookmark className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>Plan: {sharedInfo.plan || 'N/A'}</span>
                      </div>
                      <div className="flex items-center gap-1 bg-indigo-50 text-indigo-800 font-bold px-2.5 py-1 rounded-lg border border-indigo-150">
                        <Tag className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        <span>Póliza: {sharedInfo.policyName || 'N/A'}</span>
                      </div>
                      <span className="bg-amber-100 text-amber-900 font-black text-[11px] px-2 py-1 rounded-lg border border-amber-300">
                        {items.length} {items.length === 1 ? 'registro' : 'registros'}
                      </span>
                    </div>
                  </div>

                  {/* Group Items Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="bg-gray-100/70 text-gray-500 font-black text-[10px] uppercase tracking-wider border-b border-gray-200">
                          {isSuperAdmin && (
                            <th className="px-4 py-3 w-10 text-center">Sel.</th>
                          )}
                          <th className="px-4 py-3">No. Póliza / ID</th>
                          <th className="px-4 py-3">Fecha Registro</th>
                          <th className="px-4 py-3">Vigencia Total</th>
                          <th className="px-4 py-3">Agente / Canal</th>
                          <th className="px-4 py-3 text-right">Monto Total</th>
                          <th className="px-4 py-3 text-center">Estado Pago</th>
                          <th className="px-4 py-3 text-center">CareMed</th>
                          <th className="px-4 py-3 text-center">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {items.map((item, itemIdx) => {
                          const isItemSelected = item.id ? selectedIds.includes(item.id) : false;
                          const isPrimaryItem = itemIdx === 0;

                          return (
                            <tr 
                              key={item.id || itemIdx} 
                              className={`transition-colors ${
                                isItemSelected 
                                  ? 'bg-rose-50/50' 
                                  : isPrimaryItem 
                                    ? 'bg-white' 
                                    : 'bg-amber-50/20 hover:bg-amber-50/40'
                              }`}
                            >
                              {/* Selection Checkbox */}
                              {isSuperAdmin && (
                                <td className="px-4 py-3 text-center">
                                  {item.id && (
                                    <input
                                      type="checkbox"
                                      checked={isItemSelected}
                                      onChange={() => handleToggleSelectId(item.id!)}
                                      className="w-4 h-4 text-rose-600 rounded border-gray-300 focus:ring-rose-500 cursor-pointer"
                                    />
                                  )}
                                </td>
                              )}

                              {/* Policy Number & ID */}
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-bold text-gray-900">
                                    {item.policyNumber || item.IDseg || 'Sin No. Póliza'}
                                  </span>
                                  {isPrimaryItem && (
                                    <span className="bg-emerald-100 text-emerald-800 text-[9px] font-black px-1.5 py-0.5 rounded border border-emerald-200">
                                      Más Reciente
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-gray-400 font-mono mt-0.5">
                                  ID: {item.id}
                                </div>
                              </td>

                              {/* Request Date */}
                              <td className="px-4 py-3 font-semibold text-gray-700">
                                {formatToShow(item.requestDate)}
                              </td>

                              {/* Dates & Days */}
                              <td className="px-4 py-3 font-medium text-gray-700">
                                <div>{formatToShow(item.startDate)} al {formatToShow(item.endDate)}</div>
                                <div className="text-[10px] text-gray-400 font-bold">{item.days || 0} días</div>
                              </td>

                              {/* Agent / Channel */}
                              <td className="px-4 py-3">
                                {item.agentId || item.linkedAgentId ? (
                                  <span className="bg-indigo-50 border border-indigo-100 text-indigo-700 font-bold px-2 py-0.5 rounded text-[10px] inline-block">
                                    {item.agentId || item.linkedAgentId}
                                  </span>
                                ) : (
                                  <span className="text-gray-400 font-semibold text-[10px]">Cliente Directo</span>
                                )}
                              </td>

                              {/* Total Amount */}
                              <td className="px-4 py-3 text-right font-black text-gray-900">
                                ${((item.totalFinal || item.totalPrice) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>

                              {/* Payment Status */}
                              <td className="px-4 py-3 text-center">
                                <span className={`px-2 py-0.5 text-[9px] font-black rounded-full border inline-block ${
                                  item.status === 'paid' ? 'bg-green-50 text-green-700 border-green-200' : 
                                  item.status === 'pending' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' : 
                                  item.status === 'partially_paid' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                  'bg-red-50 text-red-700 border-red-200'
                                }`}>
                                  {item.status === 'paid' ? 'PAGADO' : 
                                   item.status === 'pending' ? 'PENDIENTE' : 
                                   item.status === 'partially_paid' ? 'PARCIAL' :
                                   'CANCELADO'}
                                </span>
                              </td>

                              {/* Caremed Status */}
                              <td className="px-4 py-3 text-center">
                                {item.Caremed ? (
                                  <span className="px-2 py-0.5 text-[9px] font-black rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 inline-flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                    {item.InvoiceCaremed ? `Inv: ${item.InvoiceCaremed}` : 'EXPORTADO'}
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 text-[9px] font-black rounded-full bg-gray-50 text-gray-500 border border-gray-200">
                                    PENDIENTE
                                  </span>
                                )}
                              </td>

                              {/* Actions */}
                              <td className="px-4 py-3 text-center">
                                <div className="flex items-center justify-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => onViewInsuranceDetail(item)}
                                    className="p-1.5 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-lg border border-indigo-100 transition-all cursor-pointer"
                                    title="Ver Detalle de Póliza"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </button>

                                  {isSuperAdmin && (
                                    confirmDeleteId === item.id ? (
                                      <div className="flex items-center gap-1 animate-in fade-in zoom-in-95 duration-150">
                                        <button
                                          type="button"
                                          onClick={() => item.id && handleConfirmDeleteSingle(item.id)}
                                          disabled={isDeletingSingle === item.id}
                                          className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white font-black text-[9px] rounded transition-all cursor-pointer shadow-sm disabled:opacity-50"
                                        >
                                          {isDeletingSingle === item.id ? '...' : 'Sí'}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setConfirmDeleteId(null)}
                                          className="px-2 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold text-[9px] rounded border border-gray-300 transition-all cursor-pointer"
                                        >
                                          No
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => item.id && handleDeleteClick(item.id)}
                                        className="p-1.5 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg border border-rose-150 transition-all cursor-pointer"
                                        title="Eliminar este registro duplicado"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    )
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs text-gray-500 font-medium">
            {selectedIds.length > 0 ? (
              <span className="text-rose-700 font-bold">
                {selectedIds.length} {selectedIds.length === 1 ? 'registro seleccionado' : 'registros seleccionados'} para eliminar
              </span>
            ) : (
              <span>Mostrando {filteredGroups.length} de {duplicateGroups.length} grupos duplicados</span>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            {isSuperAdmin && selectedIds.length > 0 && (
              <button
                type="button"
                onClick={() => setShowBatchDeleteConfirm(true)}
                className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl transition-all shadow-sm active:scale-95 cursor-pointer flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Borrar ({selectedIds.length})
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 bg-white hover:bg-gray-100 border border-gray-300 text-gray-700 font-bold text-xs rounded-xl transition-all shadow-sm active:scale-95 cursor-pointer"
            >
              Cerrar Ventana
            </button>
          </div>
        </div>

      </div>

      {/* Confirmation Modal for Batch Deletion */}
      {showBatchDeleteConfirm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs z-[160] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-gray-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center mb-4">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-black text-gray-900">
              ¿Eliminar {selectedIds.length} pólizas seleccionadas?
            </h3>
            <p className="text-xs text-gray-600 mt-2 leading-relaxed">
              Esta acción eliminará de forma permanente <strong className="text-rose-600">{selectedIds.length}</strong> {selectedIds.length === 1 ? 'registro de póliza duplicada' : 'registros de pólizas duplicadas'}. Esta operación no se puede deshacer.
            </p>
            
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowBatchDeleteConfirm(false)}
                disabled={isDeletingBatch}
                className="px-4 py-2.5 border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-xl font-bold text-xs transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmBatchDelete}
                disabled={isDeletingBatch}
                className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-black text-xs transition-colors shadow-md flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isDeletingBatch ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Eliminando...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Sí, Eliminar {selectedIds.length} {selectedIds.length === 1 ? 'Póliza' : 'Pólizas'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
