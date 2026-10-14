import React, { useState, useEffect, useRef, useMemo } from 'react';
import { X, Calendar, User, Mail, MapPin, Shield, DollarSign, Clock, Briefcase, Receipt, CreditCard, FileText, Plus, CheckCircle, ArrowUpRight, Pencil, Check, Printer, ArrowRight, XCircle, History, MessageSquare, Activity, Percent, Trash2, Copy, Calculator, RefreshCw, MessageCircle, RotateCcw } from 'lucide-react';
import { COUNTRIES } from '../constants';
import { collection, query, where, onSnapshot, orderBy, doc, updateDoc, getDocs, getDoc, addDoc, deleteDoc, setDoc, limit, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, auth } from '../firebase';
import { InsuranceRequest, Payment, Policy, PolicyLetter, Country, FacturaData } from '../types';
import { useNavigate } from 'react-router-dom';
import { format, parseISO, differenceInDays, differenceInYears, isValid, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import TransactionModal from './TransactionModal';
import EmailModal from './EmailModal';
import RefundModal from './RefundModal';
import StripePaymentModal from './StripePaymentModal';
import { generatePDF, generateReceiptPDF } from '../lib/pdfGenerator';
import { createZipFromPdfs, downloadBlob } from '../lib/zipUtils';
import { useCompany } from '../App';
import { triggerWhatsAppNotification } from '../services/whatsapp';
import { getPolicyNumber, getAvailableLettersForInsurance, findPolicyPrioritized, formatDisplayDate, resolvePolicyFolioAndType } from '../lib/policyUtils';
import { isCardPaymentMethod, safeNum, getInsuranceDisplayStatus, getInsuranceFinalPrice } from '../utils/paymentUtils';
import { logInsuranceActivity } from '../utils/activityLogger';
import WhatsAppPolicyLettersModal, { getPolicyWhatsAppContacts } from './WhatsAppPolicyLettersModal';

const LANGUAGE_ORDER = ['es', 'en', 'es_spain', 'embajada_spain', 'policy', 'covid', 'fr', 'it', 'de'];

const sortLettersByLanguage = <T extends { language: string }>(letters: T[]): T[] => {
  return [...letters].sort((a, b) => {
    let indexA = LANGUAGE_ORDER.indexOf(a.language);
    let indexB = LANGUAGE_ORDER.indexOf(b.language);
    if (indexA === -1) indexA = 999;
    if (indexB === -1) indexB = 999;
    
    if (indexA !== indexB) {
      return indexA - indexB;
    }
    return a.language.localeCompare(b.language);
  });
};

const getActivityIcon = (desc: string, type: string) => {
  const lowercaseDesc = desc.toLowerCase();
  if (type === 'manual') return <MessageSquare className="w-5.5 h-5.5 text-amber-600" />;
  if (lowercaseDesc.includes('pago') || lowercaseDesc.includes('total cobrado') || lowercaseDesc.includes('transacción')) {
    return <DollarSign className="w-5.5 h-5.5 text-green-600" />;
  }
  if (lowercaseDesc.includes('comisión') || lowercaseDesc.includes('comisiones')) {
    return <Briefcase className="w-5.5 h-5.5 text-indigo-600" />;
  }
  if (lowercaseDesc.includes('certificado') || lowercaseDesc.includes('descargó') || lowercaseDesc.includes('enviaron')) {
    return <FileText className="w-5.5 h-5.5 text-blue-600" />;
  }
  if (lowercaseDesc.includes('emitió') || lowercaseDesc.includes('creó') || lowercaseDesc.includes('solicitud')) {
    return <Plus className="w-5.5 h-5.5 text-cyan-600" />;
  }
  return <Activity className="w-5.5 h-5.5 text-gray-600" />;
};

const getActivityBg = (desc: string, type: string) => {
  const lowercaseDesc = desc.toLowerCase();
  if (type === 'manual') return 'bg-amber-50 border-amber-200';
  if (lowercaseDesc.includes('pago') || lowercaseDesc.includes('total cobrado') || lowercaseDesc.includes('transacción')) {
    return 'bg-green-50 border-green-200';
  }
  if (lowercaseDesc.includes('comisión') || lowercaseDesc.includes('comisiones')) {
    return 'bg-indigo-50 border-indigo-200';
  }
  if (lowercaseDesc.includes('certificado') || lowercaseDesc.includes('descargó') || lowercaseDesc.includes('enviaron')) {
    return 'bg-blue-50 border-blue-200';
  }
  if (lowercaseDesc.includes('emitió') || lowercaseDesc.includes('creó') || lowercaseDesc.includes('solicitud')) {
    return 'bg-cyan-50 border-cyan-200';
  }
  return 'bg-gray-50 border-gray-200';
};

const isInsuranceClosed = (insurance: any) => {
  if (!insurance) return false;
  if (insurance.closed === false) return false;
  
  const totalFinal = insurance.totalFinal !== undefined && insurance.totalFinal !== null 
    ? insurance.totalFinal 
    : (insurance.totalPrice || 0);
  const totalPaid = insurance.totalPaid || 0;
  const balance = totalFinal - totalPaid;
  
  const balanceIsSmall = Math.abs(balance) < 5;
  const isCommissionPaid = !insurance.agentCommission || insurance.agentCommission <= 0 || insurance.commissionStatus === 'paid';
  
  return balanceIsSmall && isCommissionPaid;
};

interface InsuranceDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  insurance: InsuranceRequest | null;
  initialAction?: 'cancel' | 'correct' | 'extension';
  onUpdateInsurance?: (ins: InsuranceRequest) => void;
  readOnly?: boolean;
}

export default function InsuranceDetailModal({ 
  isOpen, 
  onClose, 
  insurance, 
  initialAction, 
  onUpdateInsurance,
  readOnly = false 
}: InsuranceDetailModalProps) {
  const navigate = useNavigate();
  const { settings } = useCompany();
  const initialActionExecutedRef = useRef<boolean>(false);
  const [localInsurance, setLocalInsurance] = useState<InsuranceRequest | null>(insurance);
  const [currentUserRole, setCurrentUserRole] = useState<string>('none');
  const isSuperAdmin = currentUserRole === 'super_admin';
  const isSuperAdminOrDirector = currentUserRole === 'super_admin' || currentUserRole === 'director';
  const canManageClosedState = ['super_admin', 'director', 'seguros', 'administracion', 'admin'].includes(currentUserRole);
  const [showConfirmClear, setShowConfirmClear] = useState(false);

  const [isEditingAll, setIsEditingAll] = useState(false);
  const [savingEditAll, setSavingEditAll] = useState(false);
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [correctionTargetId, setCorrectionTargetId] = useState<string | null>(null);
  const [originalInsurance, setOriginalInsurance] = useState<InsuranceRequest | null>(null);
  const [originalInsuranceId, setOriginalInsuranceId] = useState<string | null>(null);
  const [insuranceTypes, setInsuranceTypes] = useState<{name: string, minAge: number, maxAge: number}[]>([]);
  const [editFormData, setEditFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    birthDate: '',
    gender: 'M',
    notes: '',
    IDseg: '',
    originCountry: 'MX',
    destinationCountry: 'US',
    city: '',
    startDate: '',
    endDate: '',
    policyId: '',
    requestDate: '',
    totalPrice: 0,
    totalCost: 0,
    discount: 0,
    adjustment: 0,
    agentCommission: 0,
    comision: 0,
    iva: 0,
    totalFinal: 0,
    actionType: 'NEW',
    clientType: 'Individual',
    clientId: '',
    linkedAgentId: '',
    solicitudFactura: false
  });

  const handleEditFormChange = (field: string, value: any) => {
    setEditFormData(prev => {
      const updated = { ...prev, [field]: value };
      
      const activeIns = localInsurance || insurance;
      if (!activeIns) return updated;

      // If actionType is changed to EXT (Extension), reset adjustment to 0
      if (field === 'actionType' && (value === 'EXT' || value === 'Ext')) {
        updated.adjustment = 0;
      }

      // Auto-recalculate day-based pricing if startDate, endDate, or policyId is updated
      if (['startDate', 'endDate', 'policyId'].includes(field)) {
        if (updated.startDate && updated.endDate && updated.policyId) {
          try {
            const startD = parseISO(updated.startDate);
            const endD = parseISO(updated.endDate);
            const d = differenceInDays(endD, startD) + 1;
            const days = d > 0 ? d : 1;
            
            const calculatedMonths = Math.floor(days / 30.4);
            const additionalDays = Math.max(0, days - Math.round(calculatedMonths * 30.4));
            
            let billedMonths = calculatedMonths;
            let billedDays = additionalDays;
            
            if (additionalDays > 15) {
              billedMonths = calculatedMonths + 1;
              billedDays = 0;
            }

            if (days < 40) {
              billedMonths = 0;
              billedDays = days;
            }
            
            // Find policy rate
            const matchedPolicy = policies.find(p => 
              p.id === updated.policyId || 
              (p.CodigoPoliza && p.CodigoPoliza === updated.policyId) ||
              p.name === updated.policyId
            );
            
            if (matchedPolicy) {
              const pricePerDay = matchedPolicy.pricePerDay || 0;
              const pricePerMonth = matchedPolicy.pricePerMonth || (pricePerDay * 30);
              
              let monthlyRate = pricePerMonth;
              if (billedMonths >= 4) {
                monthlyRate = pricePerMonth * 0.8;
              }
              
              const basePrice = (billedMonths * monthlyRate) + (billedDays * pricePerDay);
              const totalCost = (matchedPolicy.costPerDay || 0) * days;
              
              updated.totalPrice = Math.round(basePrice * 100) / 100;
              updated.totalCost = Math.round(totalCost * 100) / 100;

              // Recalculate discount based on client discount (no duplicate policy discount as it's already built into the 20% months discount)
              let calculatedDiscount = 0;
              const client = activeIns.clientId ? clients[activeIns.clientId] : null;
              const clientDiscountPercent = client?.discountPercentage || 0;
              if (clientDiscountPercent > 0) {
                calculatedDiscount = Math.round((updated.totalPrice * (clientDiscountPercent / 100)) * 100) / 100;
              }
              updated.discount = calculatedDiscount;
            }
          } catch (e) {
            console.error("Error recalculating pricing on change:", e);
          }
        }
      }

      // Auto-recalculate card commission (comision) if paymentMethod, totalPrice is updated
      const pm = activeIns.paymentMethod || '';
      const isCard = isCardPaymentMethod(pm);
      if (isCard) {
        const base = parseFloat(updated.totalPrice as any) || 0;
        updated.comision = Math.round((base * 0.045) * 100) / 100;
      }

      // Auto-recalculate agentCommission if pricing fields change
      if (['totalPrice', 'discount', 'adjustment', 'startDate', 'endDate', 'policyId'].includes(field)) {
        const base = parseFloat(updated.totalPrice as any) || 0;
        const disc = parseFloat(updated.discount as any) || 0;
        const adj = parseFloat(updated.adjustment as any) || 0;
        
        // Find commission percentage
        let commissionPercent = 0;
        if (activeIns.agentId && agents[activeIns.agentId]) {
          commissionPercent = agents[activeIns.agentId].commission || 0;
        } else if (activeIns.clientId && clients[activeIns.clientId]) {
          const client = clients[activeIns.clientId];
          if (client.type === 'Agent') {
            commissionPercent = client.commission || 0;
          } else if (activeIns.linkedAgentId && client.linkedAgents) {
            const la = client.linkedAgents.find((a: any) => a.email === activeIns.linkedAgentId || a.id === activeIns.linkedAgentId);
            if (la) commissionPercent = la.commission || 0;
          }
        }

        if (commissionPercent > 0) {
          updated.agentCommission = Math.round(((base - disc) * (commissionPercent / 100)) * 100) / 100;
        }
      }

      // Auto-recalculate totalFinal if physical value fields are updated
      if (['totalPrice', 'discount', 'adjustment', 'comision', 'startDate', 'endDate', 'policyId', 'destinationCountry', 'iva'].includes(field)) {
        const base = parseFloat(updated.totalPrice as any) || 0;
        const disc = parseFloat(updated.discount as any) || 0;
        const adj = parseFloat(updated.adjustment as any) || 0;
        const cardC = parseFloat(updated.comision as any) || 0;
        const isMexico = updated.destinationCountry === 'MX';
        
        let iva = parseFloat(updated.iva as any) || 0;
        if (field !== 'iva') {
          iva = isMexico ? Math.round(((base - disc - adj) * 0.16) * 100) / 100 : 0;
          updated.iva = iva;
        } else if (!isMexico) {
          iva = 0;
          updated.iva = 0;
        }
        
        updated.totalFinal = Math.round((base - disc - adj) * 100) / 100;
      }
      return updated;
    });
  };

  // Calculate duration and breakdown for edit form
  const editDurationBreakdown = useMemo(() => {
    if (!editFormData.startDate || !editFormData.endDate) {
      return { days: 0, billedMonths: 0, billedDays: 0, calculatedMonths: 0, additionalDays: 0 };
    }
    try {
      const startD = parseISO(editFormData.startDate);
      const endD = parseISO(editFormData.endDate);
      const d = differenceInDays(endD, startD) + 1;
      const days = d > 0 ? d : 0;
      if (days <= 0) return { days: 0, billedMonths: 0, billedDays: 0, calculatedMonths: 0, additionalDays: 0 };

      if (days < 40) {
        return { days, billedMonths: 0, billedDays: days, calculatedMonths: 0, additionalDays: days };
      }

      const calculatedMonths = Math.floor(days / 30.4);
      const additionalDays = Math.max(0, days - Math.round(calculatedMonths * 30.4));
      let billedMonths = calculatedMonths;
      let billedDays = additionalDays;
      if (additionalDays > 15) {
        billedMonths = calculatedMonths + 1;
        billedDays = 0;
      }
      return { days, billedMonths, billedDays, calculatedMonths, additionalDays };
    } catch {
      return { days: 0, billedMonths: 0, billedDays: 0, calculatedMonths: 0, additionalDays: 0 };
    }
  }, [editFormData.startDate, editFormData.endDate]);

  // Original duration before edit for comparison
  const originalDurationBreakdown = useMemo(() => {
    const activeIns = localInsurance || insurance;
    if (!activeIns?.startDate || !activeIns?.endDate) {
      return { days: activeIns?.days || 0, billedMonths: 0, billedDays: 0 };
    }
    try {
      const startD = parseISO(activeIns.startDate);
      const endD = parseISO(activeIns.endDate);
      const d = differenceInDays(endD, startD) + 1;
      const days = d > 0 ? d : (activeIns.days || 1);
      if (days < 40) {
        return { days, billedMonths: 0, billedDays: days };
      }
      const calculatedMonths = Math.floor(days / 30.4);
      const additionalDays = Math.max(0, days - Math.round(calculatedMonths * 30.4));
      let billedMonths = calculatedMonths;
      let billedDays = additionalDays;
      if (additionalDays > 15) {
        billedMonths = calculatedMonths + 1;
        billedDays = 0;
      }
      return { days, billedMonths, billedDays };
    } catch {
      return { days: activeIns?.days || 0, billedMonths: 0, billedDays: 0 };
    }
  }, [localInsurance, insurance]);

  // Handler to adjust duration by setting months and days directly
  const handleDurationChange = (type: 'months' | 'days', value: number) => {
    const baseStartDate = editFormData.startDate || format(new Date(), 'yyyy-MM-dd');
    const currentMonths = type === 'months' ? Math.max(0, value) : editDurationBreakdown.billedMonths;
    const currentDays = type === 'days' ? Math.max(0, value) : editDurationBreakdown.billedDays;

    let targetTotalDays = 0;
    if (currentMonths === 0) {
      targetTotalDays = Math.max(1, currentDays);
    } else {
      targetTotalDays = Math.round(currentMonths * 30.4) + currentDays;
    }

    if (targetTotalDays > 0) {
      try {
        const startD = parseISO(baseStartDate);
        const newEndDate = format(addDays(startD, Math.max(0, targetTotalDays - 1)), 'yyyy-MM-dd');
        handleEditFormChange('endDate', newEndDate);
      } catch (e) {
        console.error("Error setting new end date from duration change:", e);
      }
    }
  };

  // Helper to re-run full pricing calculations
  const handleRecalculatePricingDirectly = () => {
    handleEditFormChange('startDate', editFormData.startDate);
  };

  const handleSaveAllEdit = async () => {
    if (!insurance?.id) return;
    setSavingEditAll(true);
    try {
      // Calculate current date difference and update age and days fields
      let computedAge = (localInsurance || insurance).age || 0;
      if (editFormData.birthDate) {
        const refDate = editFormData.startDate ? parseISO(editFormData.startDate) : new Date();
        computedAge = Math.max(0, differenceInYears(refDate, parseISO(editFormData.birthDate)));
      }

      let computedDays = (localInsurance || insurance).days || 1;
      if (editFormData.startDate && editFormData.endDate) {
        computedDays = differenceInDays(parseISO(editFormData.endDate), parseISO(editFormData.startDate)) + 1;
      }

      const selectedPolicy = policies.find(p => p.id === editFormData.policyId);

      const updatedData = {
        firstName: editFormData.firstName,
        lastName: editFormData.lastName,
        email: editFormData.email,
        birthDate: editFormData.birthDate,
        age: computedAge,
        gender: editFormData.gender as 'M' | 'F',
        notes: editFormData.notes,
        IDseg: editFormData.IDseg,
        originCountry: editFormData.originCountry,
        destinationCountry: editFormData.destinationCountry,
        city: editFormData.city,
        startDate: editFormData.startDate,
        endDate: editFormData.endDate,
        days: computedDays,
        policyId: editFormData.policyId,
        policyName: selectedPolicy?.name || (localInsurance || insurance).policyName || '',
        plan: selectedPolicy?.plan || (localInsurance || insurance).plan || '',
        policyNumber: getPolicyNumber(selectedPolicy, computedAge),
        requestDate: editFormData.requestDate,
        totalPrice: parseFloat(editFormData.totalPrice as any) || 0,
        totalCost: parseFloat(editFormData.totalCost as any) || 0,
        discount: parseFloat(editFormData.discount as any) || 0,
        adjustment: parseFloat(editFormData.adjustment as any) || 0,
        agentCommission: parseFloat(editFormData.agentCommission as any) || 0,
        comision: parseFloat(editFormData.comision as any) || 0,
        iva: parseFloat((editFormData as any).iva as any) || 0,
        totalFinal: parseFloat(editFormData.totalFinal as any) || 0,
        actionType: editFormData.actionType,
        clientType: editFormData.clientType,
        clientId: editFormData.clientType === 'Individual' ? '' : editFormData.clientId,
        linkedAgentId: editFormData.clientType === 'Individual' ? '' : editFormData.linkedAgentId,
        solicitudFactura: editFormData.solicitudFactura,
        facturaData: editFormData.solicitudFactura ? facturaDataState : null,
        rfcFactura: editFormData.solicitudFactura ? (facturaDataState.rfc?.toUpperCase().trim() || '') : '',
        razonSocialFactura: editFormData.solicitudFactura ? (facturaDataState.razonSocial?.trim() || '') : '',
      };

      await updateDoc(doc(db, 'insurances', insurance.id), updatedData);

      // Write action to activities log (bitacora)
      await logInsuranceActivity({
        insuranceId: insurance.id,
        type: 'manual',
        description: `Super Admin/Director modificó los datos de la póliza: Fechas ${updatedData.startDate} al ${updatedData.endDate} (${computedDays} días). Precio Base: $${updatedData.totalPrice.toFixed(2)}, Total Final: $${updatedData.totalFinal.toFixed(2)}.`,
        date: new Date(),
        createdBy: auth.currentUser?.email || 'Sistema'
      });

      setIsEditingAll(false);
      alert('Seguro modificado con éxito.');
    } catch (err) {
      console.error("Error editing insurance:", err);
      alert('Error al guardar modificaciones: ' + (err as Error).message);
    } finally {
      setSavingEditAll(false);
    }
  };

  const getPlanForAge = (ageNum: number, types: any[], isExtreme: boolean = false) => {
    if (isExtreme && ageNum >= 7 && ageNum <= 69) return 'Xtreme';
    if (ageNum >= 0 && ageNum <= 6) return 'U6';
    if (ageNum >= 7 && ageNum <= 25) return 'Student';
    if (ageNum >= 26 && ageNum <= 69) return 'Traveler';
    if (ageNum >= 70) return 'O70';

    if (types && types.length > 0) {
      const matchedType = types.find(t => ageNum >= Number(t.minAge) && ageNum <= Number(t.maxAge));
      if (matchedType) return matchedType.name;
    }
    return 'Traveler';
  };

  const handleDuplicateAsCancel = async () => {
    const activeIns = localInsurance || insurance;
    if (!activeIns?.id) return;

    const confirmCancel = window.confirm(
      "¿Confirma la cancelación de esta póliza?\n\nDe manera automática se creará el registro de cancelación (CAN) y se generará un pago negativo por la misma cantidad."
    );
    if (!confirmCancel) {
      if (initialAction === 'cancel') {
        onClose();
      }
      return;
    }

    try {
      setSavingEditAll(true);
      
      // Determinar la cantidad exacta de la póliza para generar el pago negativo por la misma cantidad
      const policyAmount = Math.abs(
        (activeIns.totalFinal !== undefined && activeIns.totalFinal !== null && activeIns.totalFinal !== 0)
          ? activeIns.totalFinal
          : (activeIns.totalPaid !== undefined && activeIns.totalPaid !== null && activeIns.totalPaid !== 0)
          ? activeIns.totalPaid
          : (activeIns.totalPrice || 0)
      );

      const currency = (activeIns as any).currency || (activeIns as any).paymentCurrency || 'USD';
      let exchangeRate = Number((activeIns as any).exchangeRate || (activeIns as any).paymentExchangeRate) || 20;
      try {
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        const qRate = query(collection(db, 'exchangeRates'), where('date', '==', todayStr), limit(1));
        const rateSnap = await getDocs(qRate);
        if (!rateSnap.empty && rateSnap.docs[0].data()?.rate) {
          exchangeRate = parseFloat(rateSnap.docs[0].data().rate) || exchangeRate;
        }
      } catch (e) {
        console.warn("Could not fetch today's exchange rate:", e);
      }
      const amountMXP = Math.round(policyAmount * exchangeRate * 100) / 100;

      const duplicateData = {
        ...activeIns,
        totalPrice: -Math.abs(activeIns.totalPrice || 0),
        totalCost: -Math.abs(activeIns.totalCost || 0),
        discount: -Math.abs(activeIns.discount || 0),
        adjustment: -Math.abs(activeIns.adjustment || 0),
        agentCommission: -Math.abs(activeIns.agentCommission || 0),
        comision: -Math.abs(activeIns.comision || 0),
        totalFinal: -policyAmount,
        totalPaid: -policyAmount, // Pago negativo que equilibra el registro CAN a saldo 0
        status: 'paid',
        actionType: 'CAN',
        Caremed: null,
        InvoiceCaremed: null,
        requestDate: format(new Date(), 'yyyy-MM-dd'),
        createdAt: new Date(),
        closed: true, // Marcador para mantenerlo cerrado y no modificable
        cancelledFromInsuranceId: activeIns.id,
      };
      delete duplicateData.id;

      const newCanDocRef = await addDoc(collection(db, 'insurances'), duplicateData);
      const newCanId = newCanDocRef.id;

      // Generar de manera automática el pago negativo por la misma cantidad en la colección de pagos
      const negativePaymentData = {
        insuranceId: newCanId,
        originalInsuranceId: activeIns.id,
        amount: -policyAmount,
        currency: currency,
        amountMXP: -amountMXP,
        exchangeRate: exchangeRate,
        type: 'client_payment' as const,
        paymentMethod: activeIns.paymentMethod || 'Cancelación',
        depositAccount: (activeIns as any).depositAccount || '',
        receiptNumber: `CAN-${activeIns.receiptNumber || Math.floor(1000 + Math.random() * 9000)}`,
        status: 'completed' as const,
        date: new Date(),
        notes: `Pago negativo automático por cancelación de póliza ${activeIns.IDseg || activeIns.id || ''}`,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: auth.currentUser?.email || 'Sistema'
      };

      await addDoc(collection(db, 'payments'), negativePaymentData);

      // Actualizar registro original marcándolo como cancelado
      await updateDoc(doc(db, 'insurances', activeIns.id), {
        isCancelled: true,
        cancellationInsuranceId: newCanId,
        updatedAt: serverTimestamp()
      });

      await logInsuranceActivity({
        insuranceId: activeIns.id,
        type: 'manual',
        description: `Se canceló el seguro de forma manual. Se duplicó el registro con el tipo de acción CAN por -$${policyAmount.toFixed(2)} USD y se generó automáticamente un pago negativo por -$${policyAmount.toFixed(2)} USD (ID CAN: ${newCanId}).`,
        date: new Date(),
        createdBy: auth.currentUser?.email || 'Sistema'
      });

      await logInsuranceActivity({
        insuranceId: newCanId,
        type: 'automatic',
        description: `Póliza de cancelación CAN generada con pago negativo automático por -$${policyAmount.toFixed(2)} USD.`,
        date: new Date(),
        createdBy: auth.currentUser?.email || 'Sistema'
      });

      alert(`Póliza cancelada con éxito. Se generó el registro CAN y un pago negativo automático por -$${policyAmount.toFixed(2)} USD.`);
      onClose();
    } catch (err) {
      console.error("Error duplicating as CAN with negative payment:", err);
      alert("Error al cancelar seguro: " + (err as Error).message);
    } finally {
      setSavingEditAll(false);
    }
  };

  const handleStartCorrection = async () => {
    const activeIns = localInsurance || insurance;
    if (!activeIns?.id) return;

    try {
      setSavingEditAll(true);
      setOriginalInsuranceId(activeIns.id);
      setOriginalInsurance(activeIns);

      const duplicateData = {
        ...activeIns,
        requestDate: format(new Date(), 'yyyy-MM-dd'),
        totalPrice: 0,
        totalCost: 0,
        discount: 0,
        adjustment: 0,
        agentCommission: 0,
        comision: 0,
        totalFinal: 0,
        totalPaid: 0,
        actionType: 'COR',
        Caremed: null,
        InvoiceCaremed: null,
        createdAt: new Date(),
        closed: false, // Explicitly keep the COR record open so it can be updated during correction
      };
      delete duplicateData.id;

      const newDocRef = await addDoc(collection(db, 'insurances'), duplicateData);
      const newId = newDocRef.id;

      // Update the original record as corrected
      await updateDoc(doc(db, 'insurances', activeIns.id), {
        isCorrected: true
      });

      await logInsuranceActivity({
        insuranceId: activeIns.id,
        type: 'manual',
        description: `Se inició la corrección. Se duplicó el registro con el tipo de acción COR y con importes de $0. Nuevo registro ID: ${newId}`,
        date: new Date(),
        createdBy: auth.currentUser?.email || 'Sistema'
      });

      const newInsuranceRecord = {
        id: newId,
        ...duplicateData
      } as InsuranceRequest;

      setLocalInsurance(newInsuranceRecord);
      if (onUpdateInsurance) {
        onUpdateInsurance(newInsuranceRecord);
      }

      setEditFormData({
        firstName: duplicateData.firstName || '',
        lastName: duplicateData.lastName || '',
        email: duplicateData.email || '',
        birthDate: duplicateData.birthDate || '',
        gender: duplicateData.gender || 'M',
        notes: duplicateData.notes || '',
        IDseg: duplicateData.IDseg || '',
        originCountry: duplicateData.originCountry || 'MX',
        destinationCountry: duplicateData.destinationCountry || 'US',
        city: duplicateData.city || '',
        startDate: duplicateData.startDate || '',
        endDate: duplicateData.endDate || '',
        policyId: duplicateData.policyId || '',
        requestDate: duplicateData.requestDate || '',
        totalPrice: 0,
        totalCost: 0,
        discount: 0,
        adjustment: 0,
        agentCommission: 0,
        comision: 0,
        iva: duplicateData.iva || 0,
        totalFinal: 0,
        actionType: 'COR',
        clientType: duplicateData.clientType || 'Individual',
        clientId: duplicateData.clientId || '',
        linkedAgentId: duplicateData.linkedAgentId || '',
        solicitudFactura: !!duplicateData.solicitudFactura
      });

      setCorrectionTargetId(newId);
      setIsCorrecting(true);
      setIsEditingAll(true);
      setActiveTab('details');

    } catch (err) {
      console.error("Error starting correction:", err);
      alert("Error al iniciar corrección: " + (err as Error).message);
    } finally {
      setSavingEditAll(false);
    }
  };

  const handleSaveCorrection = async () => {
    const activeId = correctionTargetId || localInsurance?.id || insurance?.id;
    if (!activeId) return;

    const baseIns = localInsurance || insurance;
    if (!baseIns) return;

    setSavingEditAll(true);

    try {
      const newBirthDate = editFormData.birthDate;
      if (!newBirthDate) {
        alert("La fecha de nacimiento es requerida.");
        setSavingEditAll(false);
        return;
      }

      const refDate = baseIns.startDate ? parseISO(baseIns.startDate) : new Date();
      const computedAge = Math.max(0, differenceInYears(refDate, parseISO(newBirthDate)));

      const originalPlan = baseIns.plan || '';
      const newPlan = getPlanForAge(computedAge, insuranceTypes);

      if (originalPlan !== newPlan) {
        // "Si el tipo de seguro sí cambia (ej. de Student a Traveller o de Traveller a O70): El registro COR cambia su tipo de acción automáticamente a CAN y se cierra (closed: true). El precio, costo y comisión se multiplican por -1, ya que al cancelarse se tiene que deducir todo lo que se cobro y pago del registro original."
        // Find policy matching the new plan
        const originalPolicy = findPolicyPrioritized(baseIns.policyId, policies);
        let matchedPolicy = null;
        if (originalPolicy) {
          matchedPolicy = policies.find(p => 
            p.name === originalPolicy.name && 
            p.region === originalPolicy.region && 
            p.plan === newPlan
          );
        }
        if (!matchedPolicy) {
          matchedPolicy = policies.find(p => 
            p.plan === newPlan && 
            p.region === (originalPolicy?.region || 1)
          );
        }

        // Calculate pricing for the NEW record
        const days = baseIns.days || 1;
        const calculatedMonths = Math.floor(days / 30.4);
        const additionalDays = Math.max(0, days - Math.round(calculatedMonths * 30.4));
        
        let billedMonths = calculatedMonths;
        let billedDays = additionalDays;
        
        if (additionalDays > 15) {
          billedMonths = calculatedMonths + 1;
          billedDays = 0;
        }

        if (days < 40) {
          billedMonths = 0;
          billedDays = days;
        }

        let newPrice = baseIns.totalPrice || 0;
        let newCost = baseIns.totalCost || 0;
        let newDiscount = baseIns.discount || 0;
        let newAdjustment = baseIns.adjustment || 0;
        let newAgentCommission = baseIns.agentCommission || 0;
        let newComision = baseIns.comision || 0;
        let newTotalFinal = baseIns.totalFinal || 0;

        if (matchedPolicy) {
          const pricePerDay = matchedPolicy.pricePerDay || 0;
          const pricePerMonth = matchedPolicy.pricePerMonth || (pricePerDay * 30);
          
          let monthlyRate = pricePerMonth;
          if (billedMonths >= 4) {
            monthlyRate = pricePerMonth * 0.8;
          }
          
          const basePrice = (billedMonths * monthlyRate) + (billedDays * pricePerDay);
          const totalCost = (matchedPolicy.costPerDay || 0) * days;
          
          newPrice = Math.round(basePrice * 100) / 100;
          newCost = Math.round(totalCost * 100) / 100;

          // Recalculate discount based on client discount
          let calculatedDiscount = 0;
          const client = baseIns.clientId ? clients[baseIns.clientId] : null;
          const clientDiscountPercent = client?.discountPercentage || 0;
          if (clientDiscountPercent > 0) {
            calculatedDiscount = Math.round((newPrice * (clientDiscountPercent / 100)) * 100) / 100;
          }
          newDiscount = calculatedDiscount;
          newAdjustment = baseIns.adjustment || 0;

          // Recalculate comision (card commission)
          const pm = baseIns.paymentMethod || '';
          const isCard = isCardPaymentMethod(pm);
          if (isCard) {
            newComision = Math.round((newPrice * 0.045) * 100) / 100;
          } else {
            newComision = 0;
          }

          // Recalculate agent commission
          let commissionPercent = 0;
          if (baseIns.agentId && agents[baseIns.agentId]) {
            commissionPercent = agents[baseIns.agentId].commission || 0;
          } else if (baseIns.clientId && clients[baseIns.clientId]) {
            const client = clients[baseIns.clientId];
            if (client.type === 'Agent') {
              commissionPercent = client.commission || 0;
            } else if (baseIns.linkedAgentId && client.linkedAgents) {
              const la = client.linkedAgents.find((la: any) => la.email === baseIns.linkedAgentId || la.id === baseIns.linkedAgentId);
              if (la) commissionPercent = la.commission || 0;
            }
          }
          if (commissionPercent > 0) {
            newAgentCommission = Math.round(((newPrice - newDiscount - newAdjustment) * (commissionPercent / 100)) * 100) / 100;
          } else {
            newAgentCommission = 0;
          }

          // Recalculate totalFinal
          newTotalFinal = Math.round((newPrice - newDiscount - newAdjustment + newComision) * 100) / 100;
        }

        // 1. Update the COR record to CAN:
        const updatedCorToCan = {
          firstName: baseIns.firstName,
          lastName: baseIns.lastName,
          email: baseIns.email,
          birthDate: baseIns.birthDate,
          age: baseIns.age,
          gender: baseIns.gender || 'M',
          notes: baseIns.notes || '',
          IDseg: baseIns.IDseg || '',
          originCountry: baseIns.originCountry || 'MX',
          destinationCountry: baseIns.destinationCountry || 'US',
          city: baseIns.city || '',
          startDate: baseIns.startDate,
          endDate: baseIns.endDate,
          days: baseIns.days || 1,
          policyId: baseIns.policyId,
          totalPrice: (baseIns.totalPrice || 0) * -1,
          totalCost: (baseIns.totalCost || 0) * -1,
          discount: (baseIns.discount || 0) * -1,
          adjustment: (baseIns.adjustment || 0) * -1,
          agentCommission: (baseIns.agentCommission || 0) * -1,
          comision: (baseIns.comision || 0) * -1,
          totalFinal: (baseIns.totalFinal || 0) * -1,
          actionType: 'CAN',
          plan: originalPlan,
          closed: true,
          Caremed: null,
          InvoiceCaremed: null,
          requestDate: format(new Date(), 'yyyy-MM-dd')
        };

        await updateDoc(doc(db, 'insurances', activeId), updatedCorToCan);

        await logInsuranceActivity({
          insuranceId: activeId,
          type: 'manual',
          description: `Corrección requirió cambio de plan de ${originalPlan} a ${newPlan}. El registro COR cambió automáticamente a CAN (Cancelación) con montos negativos para deducción total.`,
          date: new Date(),
          createdBy: auth.currentUser?.email || 'Sistema'
        });

        // 2. Create the new NEW record:
        const newRecordData = {
          ...baseIns,
          birthDate: newBirthDate,
          age: computedAge,
          plan: newPlan,
          actionType: 'NEW',
          policyId: matchedPolicy ? matchedPolicy.id : baseIns.policyId,
          policyName: matchedPolicy ? (matchedPolicy.name || matchedPolicy.id) : (baseIns.policyName || ''),
          totalPrice: newPrice,
          totalCost: newCost,
          discount: newDiscount,
          adjustment: newAdjustment,
          agentCommission: newAgentCommission,
          comision: newComision,
          totalFinal: newTotalFinal,
          closed: false,
          Caremed: null,
          InvoiceCaremed: null,
          createdAt: new Date(),
        };
        delete newRecordData.id;

        const newRecordRef = await addDoc(collection(db, 'insurances'), newRecordData);

        await logInsuranceActivity({
          insuranceId: newRecordRef.id,
          type: 'manual',
          description: `Nuevo seguro generado con tipo de acción NEW debido al cambio de plan de ${originalPlan} a ${newPlan} por corrección de Fecha de Nacimiento. Edad recalculada: ${computedAge}.`,
          date: new Date(),
          createdBy: auth.currentUser?.email || 'Sistema'
        });

        alert(`La fecha de nacimiento cambia el tipo de seguro de ${originalPlan} a ${newPlan}.\n\nSe actualizó el registro corregido a CAN (Cancelación) con montos invertidos para deducir lo cobrado, y se ha creado un nuevo registro con tipo de acción NEW con el nuevo plan y tarifas correspondientes.`);
      } else {
        // Standard COR update:
        // "Si el tipo de seguro no cambia: Se actualiza el registro COR actualizando la fecha de nacimiento y edad con éxito, y se añade el log correspondiente en la bitácora. El precio, costo y comisión son $0, ya que ya se contabilizó en el registro original."
        const updatedCorData = {
          firstName: editFormData.firstName,
          lastName: editFormData.lastName,
          email: editFormData.email,
          birthDate: newBirthDate,
          age: computedAge,
          gender: editFormData.gender as 'M' | 'F',
          notes: editFormData.notes,
          IDseg: editFormData.IDseg,
          originCountry: editFormData.originCountry,
          destinationCountry: editFormData.destinationCountry,
          city: editFormData.city,
          startDate: editFormData.startDate,
          endDate: editFormData.endDate,
          days: baseIns.days || 1,
          policyId: editFormData.policyId,
          requestDate: editFormData.requestDate,
          totalPrice: 0,
          totalCost: 0,
          discount: 0,
          adjustment: 0,
          agentCommission: 0,
          comision: 0,
          totalFinal: 0,
          actionType: 'COR',
          plan: originalPlan,
          closed: true,
          clientType: editFormData.clientType,
          clientId: editFormData.clientType === 'Individual' ? '' : editFormData.clientId,
          linkedAgentId: editFormData.clientType === 'Individual' ? '' : editFormData.linkedAgentId,
          Caremed: null,
          InvoiceCaremed: null,
        };

        await updateDoc(doc(db, 'insurances', activeId), updatedCorData);

        await logInsuranceActivity({
          insuranceId: activeId,
          type: 'manual',
          description: `Se actualizó la Fecha de Nacimiento en el registro de corrección (COR) a ${newBirthDate} (Edad: ${computedAge}). No hubo cambio de plan (${originalPlan}); los importes de este registro de corrección se establecieron en $0.`,
          date: new Date(),
          createdBy: auth.currentUser?.email || 'Sistema'
        });

        alert("Se actualizó la fecha de nacimiento en el registro de corrección (COR) con éxito. Los montos se establecieron en $0.");
      }

      setIsEditingAll(false);
      setIsCorrecting(false);
      setCorrectionTargetId(null);
      onClose();
    } catch (err) {
      console.error("Error saving correction:", err);
      alert("Error al guardar la corrección: " + (err as Error).message);
    } finally {
      setSavingEditAll(false);
    }
  };

  const handleCancelCorrection = async () => {
    if (correctionTargetId) {
      try {
        setSavingEditAll(true);
        await deleteDoc(doc(db, 'insurances', correctionTargetId));
        
        const origId = originalInsuranceId || (insurance?.id !== correctionTargetId ? insurance?.id : null);
        if (origId && origId !== correctionTargetId) {
          await updateDoc(doc(db, 'insurances', origId), {
            isCorrected: false
          });
        }

        if (originalInsurance) {
          const restoredOriginal = {
            ...originalInsurance,
            isCorrected: false
          };
          setLocalInsurance(restoredOriginal);
          if (onUpdateInsurance) {
            onUpdateInsurance(restoredOriginal);
          }
        }

        setCorrectionTargetId(null);
        setIsCorrecting(false);
        setIsEditingAll(false);
      } catch (err) {
        console.error("Error discarding correction record:", err);
        alert("Error al descartar la corrección: " + (err as Error).message);
      } finally {
        setSavingEditAll(false);
      }
    } else {
      setIsCorrecting(false);
      setIsEditingAll(false);
    }
  };
  const [payments, setPayments] = useState<Payment[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [policyLetters, setPolicyLetters] = useState<PolicyLetter[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [clients, setClients] = useState<Record<string, any>>({});

  const getCountryName = (code: string) => {
    const found = countries.find(c => c.code === code) || COUNTRIES.find(c => c.code === code);
    return found ? found.name : code;
  };
  const [agents, setAgents] = useState<Record<string, any>>({});
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [activeTab, setActiveTab] = useState<'details' | 'payments' | 'commissions' | 'bitacora'>('details');
  const [activities, setActivities] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [showStripeModal, setShowStripeModal] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [showDiscountCommissionModal, setShowDiscountCommissionModal] = useState(false);
  const [discountCommissionAmount, setDiscountCommissionAmount] = useState<string>('');
  const [discountCommissionNotes, setDiscountCommissionNotes] = useState<string>('');
  const [isSavingDiscountCommission, setIsSavingDiscountCommission] = useState(false);

  // Solicitud Factura State and Actions
  const [solicitudFacturaState, setSolicitudFacturaState] = useState<boolean>(false);
  const [facturaDataState, setFacturaDataState] = useState<FacturaData>({
    rfc: '',
    razonSocial: '',
    direccion: '',
    ciudad: '',
    state: '',
    zip: '',
    country: 'MX',
    email: '',
    regimenFiscal: '',
    cfdiUse: '',
  });
  const [savingFactura, setSavingFactura] = useState<boolean>(false);
  const [facturaSavedSuccess, setFacturaSavedSuccess] = useState<boolean>(false);
  const [updateClientProfileToo, setUpdateClientProfileToo] = useState<boolean>(true);

  // Helper to fetch billing data from client's profile
  const populateFacturaFromClientProfile = (forceDefaults: boolean = false) => {
    const currentIns = localInsurance || insurance;
    if (!currentIns) return;

    let matchedClient: any = null;
    if (currentIns.clientId && clients[currentIns.clientId]) {
      matchedClient = clients[currentIns.clientId];
    } else if (currentIns.email) {
      matchedClient = Object.values(clients).find(
        (c: any) => c.email && c.email.trim().toLowerCase() === currentIns.email.trim().toLowerCase()
      );
    }

    if (matchedClient) {
      const isInd = matchedClient.type === 'Individual';
      const clientFullName = `${matchedClient.firstName || ''} ${matchedClient.lastName || ''}`.trim();
      const derivedRazonSocial = isInd
        ? (clientFullName || `${currentIns.firstName} ${currentIns.lastName}`.trim())
        : (matchedClient.legalName || matchedClient.commercialName || clientFullName || `${currentIns.firstName} ${currentIns.lastName}`.trim());

      setFacturaDataState(prev => ({
        rfc: (matchedClient.rfc || (forceDefaults ? '' : prev.rfc) || '').toUpperCase(),
        razonSocial: derivedRazonSocial || (forceDefaults ? '' : prev.razonSocial) || `${currentIns.firstName} ${currentIns.lastName}`.trim(),
        direccion: matchedClient.address || (forceDefaults ? '' : prev.direccion) || '',
        ciudad: matchedClient.city || currentIns.city || (forceDefaults ? '' : prev.ciudad) || '',
        state: matchedClient.state || (forceDefaults ? '' : prev.state) || '',
        zip: matchedClient.zip || (forceDefaults ? '' : prev.zip) || '',
        country: matchedClient.country || currentIns.originCountry || (forceDefaults ? 'MX' : prev.country) || 'MX',
        email: matchedClient.email || currentIns.email || (forceDefaults ? '' : prev.email) || '',
        regimenFiscal: matchedClient.regimenFiscal || (forceDefaults ? '' : prev.regimenFiscal) || '',
        cfdiUse: matchedClient.cfdiUse || (forceDefaults ? '' : prev.cfdiUse) || '',
      }));
    } else {
      setFacturaDataState(prev => ({
        ...prev,
        razonSocial: prev.razonSocial || `${currentIns.firstName} ${currentIns.lastName}`.trim(),
        email: prev.email || currentIns.email || '',
        ciudad: prev.ciudad || currentIns.city || '',
        country: prev.country || currentIns.originCountry || 'MX'
      }));
    }
  };

  const handleToggleDetailSolicitudFactura = async (wantsFactura: boolean) => {
    setSolicitudFacturaState(wantsFactura);
    if (wantsFactura) {
      const currentIns = localInsurance || insurance;
      const existingData = currentIns?.facturaData;
      if (!existingData?.rfc && !existingData?.razonSocial) {
        populateFacturaFromClientProfile();
      }
    } else {
      await handleSaveSolicitudFactura(false);
    }
  };

  const handleSaveSolicitudFactura = async (wantsFactura: boolean) => {
    const currentIns = localInsurance || insurance;
    if (!currentIns?.id) return;

    setSavingFactura(true);
    setFacturaSavedSuccess(false);

    try {
      const updatePayload: any = {
        solicitudFactura: wantsFactura,
      };

      if (wantsFactura) {
        const cleanedFactura: FacturaData = {
          rfc: (facturaDataState.rfc || '').toUpperCase().trim(),
          razonSocial: (facturaDataState.razonSocial || '').trim(),
          direccion: (facturaDataState.direccion || '').trim(),
          ciudad: (facturaDataState.ciudad || '').trim(),
          state: (facturaDataState.state || '').trim(),
          zip: (facturaDataState.zip || '').trim(),
          country: (facturaDataState.country || 'MX').trim(),
          email: (facturaDataState.email || '').trim(),
          regimenFiscal: (facturaDataState.regimenFiscal || '').trim(),
          cfdiUse: (facturaDataState.cfdiUse || '').trim(),
        };
        updatePayload.facturaData = cleanedFactura;
        updatePayload.rfcFactura = cleanedFactura.rfc || '';
        updatePayload.razonSocialFactura = cleanedFactura.razonSocial || '';
      }

      await updateDoc(doc(db, 'insurances', currentIns.id), updatePayload);

      // Optionally sync client profile
      const targetClientId = currentIns.clientId;
      if (wantsFactura && updateClientProfileToo && targetClientId) {
        try {
          const clientUpdate: any = {};
          if (facturaDataState.rfc) clientUpdate.rfc = facturaDataState.rfc.toUpperCase().trim();
          if (facturaDataState.direccion) clientUpdate.address = facturaDataState.direccion.trim();
          if (facturaDataState.ciudad) clientUpdate.city = facturaDataState.ciudad.trim();
          if (facturaDataState.state) clientUpdate.state = facturaDataState.state.trim();
          if (facturaDataState.zip) clientUpdate.zip = facturaDataState.zip.trim();
          if (facturaDataState.country) clientUpdate.country = facturaDataState.country.trim();
          if (facturaDataState.regimenFiscal) clientUpdate.regimenFiscal = facturaDataState.regimenFiscal.trim();
          if (facturaDataState.cfdiUse) clientUpdate.cfdiUse = facturaDataState.cfdiUse.trim();

          if (Object.keys(clientUpdate).length > 0) {
            await updateDoc(doc(db, 'clients', targetClientId), clientUpdate);
          }
        } catch (clientErr) {
          console.error("Error updating client billing profile:", clientErr);
        }
      }

      await logInsuranceActivity({
        insuranceId: currentIns.id,
        type: 'manual',
        description: wantsFactura
          ? `Solicitud de Factura activada (RFC: ${facturaDataState.rfc || 'Sin RFC'}, Razón: ${facturaDataState.razonSocial || 'N/A'})`
          : `Solicitud de Factura desactivada (No requiere factura)`,
        date: new Date(),
        createdBy: auth.currentUser?.email || 'Sistema'
      });

      setFacturaSavedSuccess(true);
      setTimeout(() => setFacturaSavedSuccess(false), 4000);
    } catch (err: any) {
      console.error("Error saving factura:", err);
      alert('Error al guardar datos de facturación: ' + err.message);
    } finally {
      setSavingFactura(false);
    }
  };

  // 1. Calculate destination region for the currently edited destination country
  const editDestinationRegion = useMemo((): 1 | 2 => {
    const destCode = (editFormData.destinationCountry || '').trim().toUpperCase();
    if (['US', 'CA', 'WW', 'PR', 'VI', 'GU'].includes(destCode)) {
      return 1;
    }
    const allCountriesList = countries.length > 0 ? countries : COUNTRIES;
    const matchedCountry = allCountriesList.find(c => 
      c.code.toUpperCase() === destCode || 
      (c.name && c.name.trim().toLowerCase() === (editFormData.destinationCountry || '').trim().toLowerCase())
    );
    return matchedCountry?.region === 1 ? 1 : 2;
  }, [editFormData.destinationCountry, countries]);

  // 2. Calculate the user's age dynamically based on birthDate and startDate (or fallback to original record)
  const editUserAge = useMemo((): number => {
    const birthDateStr = editFormData.birthDate || (localInsurance || insurance)?.birthDate;
    if (!birthDateStr) {
      const activeIns = localInsurance || insurance;
      return (activeIns?.age !== undefined && activeIns?.age !== null) ? Number(activeIns.age) : 25;
    }
    try {
      const refDateStr = editFormData.startDate || (localInsurance || insurance)?.startDate || format(new Date(), 'yyyy-MM-dd');
      const refDate = parseISO(refDateStr);
      const bDate = parseISO(birthDateStr);
      return Math.max(0, differenceInYears(refDate, bDate));
    } catch {
      const activeIns = localInsurance || insurance;
      return (activeIns?.age !== undefined && activeIns?.age !== null) ? Number(activeIns.age) : 25;
    }
  }, [editFormData.birthDate, editFormData.startDate, localInsurance, insurance]);

  // 3. Filter policies strictly to those that are viable for the user given their age and destination
  const viablePolicies = useMemo(() => {
    const activeIns = localInsurance || insurance;
    const isExtremeRequested = (editFormData as any).isExtremeSports || activeIns?.isExtremeSports || (activeIns?.plan || '').toLowerCase() === 'xtreme';

    return policies.filter(p => {
      // Must be active (or without status for legacy data)
      if (p.status && p.status !== 'active') {
        return false;
      }

      // Must match the destination region (Region 1: USA/Canada/Mundial, Region 2: Rest of world)
      const policyRegion: 1 | 2 = Number(p.region) === 1 ? 1 : 2;
      if (policyRegion !== editDestinationRegion) {
        return false;
      }

      const planName = (p.plan || '').trim().toLowerCase();
      const policyName = (p.name || '').trim().toLowerCase();

      // Check configured insuranceTypes from database first
      const matchedType = insuranceTypes.find(t => t.name.trim().toLowerCase() === planName);
      if (matchedType) {
        const minA = Number(matchedType.minAge);
        const maxA = Number(matchedType.maxAge);
        if (editUserAge < minA || editUserAge > maxA) {
          return false;
        }
        if (planName === 'xtreme' && !isExtremeRequested) {
          return false;
        }
        return true;
      }

      // Standard built-in plan type age rules
      if (planName === 'u6' || policyName.includes('u6')) {
        return editUserAge >= 0 && editUserAge <= 6;
      }
      if (planName === 'student' || policyName.includes('student') || policyName.includes('estudiante')) {
        return editUserAge >= 7 && editUserAge <= 25;
      }
      if (planName === 'traveler' || planName === 'traveller' || policyName.includes('traveler') || policyName.includes('traveller') || policyName.includes('viajero')) {
        return editUserAge >= 26 && editUserAge <= 69;
      }
      if (planName === 'platinum' || policyName.includes('platinum') || policyName.includes('platino')) {
        return editUserAge >= 0 && editUserAge <= 69;
      }
      if (planName === 'xtreme' || policyName.includes('xtreme')) {
        return isExtremeRequested && editUserAge >= 7 && editUserAge <= 69;
      }
      if (planName === 'o70' || policyName.includes('o70') || policyName.includes('mayor')) {
        return editUserAge >= 70;
      }

      // If custom unknown plan, check if min/max age are specified directly on the policy
      if ((p as any).minAge !== undefined && (p as any).maxAge !== undefined) {
        return editUserAge >= Number((p as any).minAge) && editUserAge <= Number((p as any).maxAge);
      }

      return true;
    });
  }, [policies, editDestinationRegion, editUserAge, insuranceTypes, editFormData, localInsurance, insurance]);

  // Keep policy selection valid within viable policies during editing
  useEffect(() => {
    if (isEditingAll && viablePolicies.length > 0) {
      const currentMatched = viablePolicies.find(p => 
        p.id === editFormData.policyId || 
        (p.CodigoPoliza && p.CodigoPoliza === editFormData.policyId) ||
        p.name === editFormData.policyId
      );
      if (!currentMatched) {
        // If current policy is not viable for the age or destination, switch to the first viable one and recalculate pricing
        handleEditFormChange('policyId', viablePolicies[0].id);
      } else if (editFormData.policyId !== currentMatched.id) {
        // Normalize policy ID to the exact document ID so the <select> accurately reflects it
        handleEditFormChange('policyId', currentMatched.id);
      }
    }
  }, [isEditingAll, viablePolicies]);
  const [showExtensionDialog, setShowExtensionDialog] = useState(false);
  const [extensionEndDate, setExtensionEndDate] = useState('');
  const [isCreatingExtension, setIsCreatingExtension] = useState(false);

  const getExtensionStartDate = () => {
    const activeIns = localInsurance || insurance;
    if (!activeIns?.endDate) return '';
    try {
      const originalEnd = parseISO(activeIns.endDate);
      const nextDay = new Date(originalEnd.getTime() + 24 * 60 * 60 * 1000);
      return format(nextDay, 'yyyy-MM-dd');
    } catch (e) {
      console.error(e);
      return '';
    }
  };

  const calculateExtensionPricing = (startStr: string, endStr: string) => {
    const activeIns = localInsurance || insurance;
    if (!activeIns) return null;

    try {
      const startD = parseISO(startStr);
      const endD = parseISO(endStr);
      const d = differenceInDays(endD, startD) + 1;
      const days = d > 0 ? d : 1;
      
      const calculatedMonths = Math.floor(days / 30.4);
      const additionalDays = Math.max(0, days - Math.round(calculatedMonths * 30.4));
      
      let billedMonths = calculatedMonths;
      let billedDays = additionalDays;
      
      if (additionalDays > 15) {
        billedMonths = calculatedMonths + 1;
        billedDays = 0;
      }

      if (days < 40) {
        billedMonths = 0;
        billedDays = days;
      }
      
      // Find policy rate
      const matchedPolicy = policies.find(p => 
        p.id === activeIns.policyId || 
        (p.CodigoPoliza && p.CodigoPoliza === activeIns.policyId) ||
        p.name === activeIns.policyId
      );
      
      let totalPrice = 0;
      let totalCost = 0;
      let discount = 0;
      let comision = 0;
      let agentCommission = 0;
      let totalFinal = 0;

      if (matchedPolicy) {
        const pricePerDay = matchedPolicy.pricePerDay || 0;
        const pricePerMonth = matchedPolicy.pricePerMonth || (pricePerDay * 30);
        
        let monthlyRate = pricePerMonth;
        if (billedMonths >= 4) {
          monthlyRate = pricePerMonth * 0.8;
        }
        
        const basePrice = (billedMonths * monthlyRate) + (billedDays * pricePerDay);
        const calcCost = (matchedPolicy.costPerDay || 0) * days;
        
        totalPrice = Math.round(basePrice * 100) / 100;
        totalCost = Math.round(calcCost * 100) / 100;

        // Recalculate discount based on client discount
        let calculatedDiscount = 0;
        const client = activeIns.clientId ? clients[activeIns.clientId] : null;
        const clientDiscountPercent = client?.discountPercentage || 0;
        if (clientDiscountPercent > 0) {
          calculatedDiscount = Math.round((totalPrice * (clientDiscountPercent / 100)) * 100) / 100;
        }
        discount = calculatedDiscount;
      }

      // Auto-recalculate card commission (comision) if paymentMethod
      const pm = activeIns.paymentMethod || '';
      const isCard = isCardPaymentMethod(pm);
      if (isCard) {
        comision = Math.round((totalPrice * 0.045) * 100) / 100;
      }

      // Find agent commission percentage
      let commissionPercent = 0;
      if (activeIns.agentId && agents[activeIns.agentId]) {
        commissionPercent = agents[activeIns.agentId].commission || 0;
      } else if (activeIns.clientId && clients[activeIns.clientId]) {
        const client = clients[activeIns.clientId];
        if (client.type === 'Agent') {
          commissionPercent = client.commission || 0;
        } else if (activeIns.linkedAgentId && client.linkedAgents) {
          const la = client.linkedAgents.find((a: any) => a.email === activeIns.linkedAgentId || a.id === activeIns.linkedAgentId);
          if (la) commissionPercent = la.commission || 0;
        }
      }

      const adj = 0; // Extensions always clear adjustment fields (set to 0)
      if (commissionPercent > 0) {
        agentCommission = Math.round(((totalPrice - discount) * (commissionPercent / 100)) * 100) / 100;
      }

      const isMexico = activeIns.destinationCountry === 'MX';
      const iva = isMexico ? Math.round(((totalPrice - discount - adj) * 0.16) * 100) / 100 : 0;

      totalFinal = Math.round((totalPrice - discount - adj + iva + comision) * 100) / 100;

      return {
        days,
        totalPrice,
        totalCost,
        discount,
        comision,
        agentCommission,
        iva,
        totalFinal
      };
    } catch (e) {
      console.error("Error calculating extension pricing:", e);
      return null;
    }
  };

  const handleStartExtension = () => {
    const activeIns = localInsurance || insurance;
    if (!activeIns) return;
    const startStr = getExtensionStartDate();
    if (!startStr) {
      alert("Error al calcular la fecha de inicio para la extensión.");
      return;
    }
    setExtensionEndDate(startStr); // default new end date to start date initially
    setShowExtensionDialog(true);
  };

  const handleCreateExtension = async () => {
    const activeIns = localInsurance || insurance;
    if (!activeIns?.id) return;

    if (!extensionEndDate) {
      alert("Por favor, selecciona la nueva fecha de término.");
      return;
    }

    const startStr = getExtensionStartDate();
    if (!startStr) {
      alert("Error al calcular la fecha de inicio de la extensión.");
      return;
    }

    if (extensionEndDate < startStr) {
      alert("La fecha de regreso debe ser igual o posterior a la fecha de inicio.");
      return;
    }

    try {
      setIsCreatingExtension(true);

      const pricing = calculateExtensionPricing(startStr, extensionEndDate);
      if (!pricing) {
        throw new Error("No se pudo calcular el precio del nuevo seguro.");
      }

      // Generate a new sequential IDseg for the extension
      let newIDseg = '';
      try {
        const counterDocRef = doc(db, 'settings', 'counters');
        const counterDocSnap = await getDoc(counterDocRef);
        let nextNum = 10001;
        let prefix = 'IDseg';
        let padLength = 5;

        if (counterDocSnap.exists()) {
          const counterData = counterDocSnap.data();
          if (counterData.IDsegCounter !== undefined) {
            nextNum = Number(counterData.IDsegCounter) + 1;
          }
          if (counterData.IDsegPrefix) {
            prefix = counterData.IDsegPrefix;
          }
          if (counterData.IDsegPadLength) {
            padLength = Number(counterData.IDsegPadLength);
          }
        }

        newIDseg = `${prefix}${String(nextNum).padStart(padLength, '0')}`;
        
        // Update the counter in firestore
        await setDoc(counterDocRef, {
          IDsegCounter: nextNum,
          IDsegPrefix: prefix,
          IDsegPadLength: padLength
        }, { merge: true });
      } catch (err) {
        console.error("Error generating sequential IDseg for extension:", err);
      }

      const duplicateData: any = {
        ...activeIns,
        requestDate: format(new Date(), 'yyyy-MM-dd'),
        startDate: startStr,
        endDate: extensionEndDate,
        days: pricing.days,
        totalPrice: pricing.totalPrice,
        totalCost: pricing.totalCost,
        discount: pricing.discount,
        comision: pricing.comision,
        iva: pricing.iva || 0,
        agentCommission: pricing.agentCommission,
        totalFinal: pricing.totalFinal,
        adjustment: 0, // Clear adjustment field for extensions
        totalPaid: 0, // Fresh record starts with 0 paid
        actionType: 'EXT',
        createdAt: new Date(),
        closed: false, // New extension can be edited/paid
        stripePaymentLink: null, // Clear payment link
        Caremed: null, // Clear CareMed export date for extensions
        InvoiceCaremed: null, // Clear CareMed invoice for extensions
      };

      if (newIDseg) {
        duplicateData.IDseg = newIDseg;
      }
      
      // Delete ID to let Firestore create a new document
      delete duplicateData.id;

      const newDocRef = await addDoc(collection(db, 'insurances'), duplicateData);
      const newId = newDocRef.id;

      // Add log inside original insurance activities
      await logInsuranceActivity({
        insuranceId: activeIns.id,
        type: 'manual',
        description: `Se creó una extensión (EXT) desde este seguro. Nueva póliza ID: ${newId}. Fechas: ${startStr} al ${extensionEndDate}`,
        date: new Date(),
        createdBy: auth.currentUser?.email || 'Sistema'
      });

      // Add log inside new extension insurance activities
      await logInsuranceActivity({
        insuranceId: newId,
        type: 'manual',
        description: `Póliza de extensión (EXT) creada automáticamente desde la póliza original ID: ${activeIns.id}. Fechas: ${startStr} al ${extensionEndDate}. Días: ${pricing.days}`,
        date: new Date(),
        createdBy: auth.currentUser?.email || 'Sistema'
      });

      alert(`Extensión generada con éxito con tipo de acción EXT.\nNuevo ID de Seguro: ${newId}`);
      
      setShowExtensionDialog(false);
      onClose(); // Close the current detail modal
    } catch (err: any) {
      console.error("Error creating extension:", err);
      alert("Error al crear extensión: " + err.message);
    } finally {
      setIsCreatingExtension(false);
    }
  };
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);
  const [editingCommissionId, setEditingCommissionId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState<string>('');
  const [isEditingIDseg, setIsEditingIDseg] = useState(false);
  const [tempIDseg, setTempIDseg] = useState('');
  const [savingIDseg, setSavingIDseg] = useState(false);
  const [isEditingInvoiceCaremed, setIsEditingInvoiceCaremed] = useState(false);
  const [tempInvoiceCaremed, setTempInvoiceCaremed] = useState('');
  const [savingInvoiceCaremed, setSavingInvoiceCaremed] = useState(false);
  const [isUpdatingLock, setIsUpdatingLock] = useState(false);
  const [generatingStripeLink, setGeneratingStripeLink] = useState(false);
  const [stripeLinkCopied, setStripeLinkCopied] = useState(false);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setStripeLinkCopied(true);
      setTimeout(() => setStripeLinkCopied(false), 2000);
    }).catch(err => {
      console.error('Fallo al copiar', err);
    });
  };

  const handleGenerateStripeLink = async () => {
    const activeIns = localInsurance || insurance;
    if (!activeIns || !activeIns.id) return;

    const isCancellation = activeIns.actionType === 'CAN';
    const multiplier = isCancellation ? -1 : 1;
    const basePrice = activeIns.totalPrice || 0;
    const discountVal = activeIns.discount || 0;
    const adjustmentVal = activeIns.adjustment || 0;
    const insuranceTotalPrice = isCancellation
      ? (activeIns.totalPrice !== undefined && activeIns.totalPrice !== 0 ? activeIns.totalPrice : (activeIns.totalFinal || 0))
      : (basePrice - discountVal - adjustmentVal);
    const displayTotalPrice = insuranceTotalPrice * multiplier;
    const displayTotalPaid = (activeIns.totalPaid || 0) * multiplier;
    const currentPendingBalance = displayTotalPrice - displayTotalPaid;
    
    if (currentPendingBalance <= 0) {
      alert("El saldo pendiente es de $0 USD o menor. No es posible generar liga de pago.");
      return;
    }

    setGeneratingStripeLink(true);
    try {
      const response = await fetch('/api/stripe/create-payment-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: currentPendingBalance,
          currency: 'USD',
          description: `Pago de Póliza de Seguro ${activeIns.firstName} ${activeIns.lastName} - Balance Pendiente`,
          clientEmail: activeIns.email,
          insuranceId: activeIns.id,
          origin: window.location.origin
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Fallo al generar el enlace de pago');
      }

      const data = await response.json();
      if (!data.success || !data.url) {
        throw new Error('No se recibió la URL de pago de Stripe');
      }

      const generatedUrl = data.url;

      // Update insurance in Firestore
      await updateDoc(doc(db, 'insurances', activeIns.id), {
        stripePaymentLink: generatedUrl
      });

      // Write activity to log
      await logInsuranceActivity({
        insuranceId: activeIns.id,
        type: 'manual',
        description: `Se generó enlace de pago de Stripe por $${currentPendingBalance.toFixed(2)} USD para el saldo pendiente. Enlace: ${generatedUrl}`,
        date: new Date(),
        createdBy: auth.currentUser?.email || 'Sistema'
      });

      alert('Enlace de pago de Stripe generado y guardado exitosamente.');
    } catch (error: any) {
      console.error('Error generating Stripe link:', error);
      alert('Error al generar enlace: ' + error.message);
    } finally {
      setGeneratingStripeLink(false);
    }
  };

  const [dispatchModal, setDispatchModal] = useState<{
    isOpen: boolean;
    availableLetters: PolicyLetter[];
    selectedLanguages: string[];
    sendToClient: boolean;
    additionalEmails: string;
    sending: boolean;
    status: 'idle' | 'success' | 'error';
    errorMsg?: string;
  }>({
    isOpen: false,
    availableLetters: [],
    selectedLanguages: [],
    sendToClient: true,
    additionalEmails: '',
    sending: false,
    status: 'idle'
  });

  useEffect(() => {
    setLocalInsurance(insurance);
    if (isOpen && insurance && !isCorrecting && !correctionTargetId) {
      setOriginalInsurance(insurance);
      setOriginalInsuranceId(insurance.id);
    }
  }, [insurance, isOpen, isCorrecting, correctionTargetId]);

  useEffect(() => {
    if (isOpen) {
      if (initialAction && (localInsurance || insurance) && !initialActionExecutedRef.current) {
        initialActionExecutedRef.current = true;
        const timer = setTimeout(() => {
          if (initialAction === 'cancel') {
            handleDuplicateAsCancel();
          } else if (initialAction === 'correct') {
            handleStartCorrection();
          } else if (initialAction === 'extension') {
            handleStartExtension();
          }
        }, 300);
        return () => clearTimeout(timer);
      }
    } else {
      initialActionExecutedRef.current = false;
    }
  }, [isOpen, initialAction, insurance?.id]);

  useEffect(() => {
    const currentIns = localInsurance || insurance;
    if (isOpen && currentIns) {
      setEditFormData({
        firstName: currentIns.firstName || '',
        lastName: currentIns.lastName || '',
        email: currentIns.email || '',
        birthDate: currentIns.birthDate || '',
        gender: currentIns.gender || 'M',
        notes: currentIns.notes || '',
        IDseg: currentIns.IDseg || '',
        originCountry: currentIns.originCountry || 'MX',
        destinationCountry: currentIns.destinationCountry || 'US',
        city: currentIns.city || '',
        startDate: currentIns.startDate || '',
        endDate: currentIns.endDate || '',
        policyId: currentIns.policyId || '',
        requestDate: currentIns.requestDate || (currentIns.createdAt?.toDate ? format(currentIns.createdAt.toDate(), 'yyyy-MM-dd') : (currentIns.createdAt ? format(new Date(currentIns.createdAt), 'yyyy-MM-dd') : '')),
        totalPrice: currentIns.totalPrice || 0,
        totalCost: currentIns.totalCost || 0,
        discount: currentIns.discount || 0,
        adjustment: currentIns.adjustment || 0,
        agentCommission: currentIns.agentCommission || 0,
        comision: currentIns.comision || 0,
        iva: currentIns.iva || 0,
        totalFinal: currentIns.totalFinal || 0,
        actionType: currentIns.actionType || 'NEW',
        clientType: currentIns.clientType || 'Individual',
        clientId: currentIns.clientId || '',
        linkedAgentId: currentIns.linkedAgentId || '',
        solicitudFactura: !!currentIns.solicitudFactura
      });

      setSolicitudFacturaState(!!currentIns.solicitudFactura);
      const fd = currentIns.facturaData || {};
      setFacturaDataState({
        rfc: fd.rfc || currentIns.rfcFactura || '',
        razonSocial: fd.razonSocial || currentIns.razonSocialFactura || '',
        direccion: fd.direccion || '',
        ciudad: fd.ciudad || currentIns.city || '',
        state: fd.state || '',
        zip: fd.zip || '',
        country: fd.country || currentIns.originCountry || 'MX',
        email: fd.email || currentIns.email || '',
        regimenFiscal: fd.regimenFiscal || '',
        cfdiUse: fd.cfdiUse || '',
      });
    }
  }, [insurance?.id, localInsurance?.id, isOpen]);

  useEffect(() => {
    if (!isCorrecting && !correctionTargetId) {
      setIsEditingAll(false);
      setIsEditingIDseg(false);
      setIsEditingInvoiceCaremed(false);
      setEditingCommissionId(null);
      setEditAmount('');
      setTempIDseg('');
      setTempInvoiceCaremed('');
      setSavingEditAll(false);
      setSavingIDseg(false);
      setSavingInvoiceCaremed(false);
    }
  }, [insurance?.id, isOpen, isCorrecting, correctionTargetId]);

  useEffect(() => {
    if (isOpen && insurance?.id && !isCorrecting) {
      const unsub = onSnapshot(doc(db, 'insurances', insurance.id), (docSnap) => {
        if (docSnap.exists()) {
          setLocalInsurance({ id: docSnap.id, ...docSnap.data() } as InsuranceRequest);
        }
      });
      return () => unsub();
    }
  }, [isOpen, insurance?.id, isCorrecting]);

  const handleClearExportDate = async () => {
    const activeId = localInsurance?.id || insurance?.id;
    if (!activeId) return;
    try {
      await updateDoc(doc(db, 'insurances', activeId), {
        Caremed: ''
      });
      
      await logInsuranceActivity({
        insuranceId: activeId,
        type: 'manual',
        description: `Se eliminó la fecha de exportación CareMed por el ${currentUserRole === 'super_admin' ? 'Super Administrador' : 'Director'}.`,
        date: new Date(),
        createdBy: auth.currentUser?.email || 'Sistema'
      });
    } catch (err) {
      console.error("Error clearing export date:", err);
      alert("Error al borrar la fecha de exportación CareMed: " + (err as Error).message);
    }
  };

  useEffect(() => {
    const fetchUserRole = async () => {
      if (auth.currentUser?.email) {
        const email = auth.currentUser.email.toLowerCase();
        if (['ventas@misegurointernacional.com', 'wrhg1970@gmail.com'].includes(email)) {
          setCurrentUserRole('super_admin');
          return;
        }
      }
      if (auth.currentUser?.uid) {
        try {
          const uDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
          if (uDoc.exists()) {
            setCurrentUserRole(uDoc.data().role || 'none');
          }
        } catch (err) {
          console.error("Error fetching user role in modal:", err);
        }
      }
    };
    if (isOpen) {
      fetchUserRole();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && insurance?.id) {
      const activeIns = localInsurance || insurance;
      const isCan = activeIns.actionType?.toUpperCase() === 'CAN' || activeIns.actionType === 'Can' || activeIns.status === 'cancelled';
      if (!isCan) {
        const finalPrice = getInsuranceFinalPrice(activeIns);
        const totalPaid = activeIns.totalPaid || 0;
        const balance = finalPrice - totalPaid;
        const targetStatus = balance <= 5 ? 'paid' : (totalPaid > 0 ? 'partially_paid' : 'pending');
        if (activeIns.status !== targetStatus || (activeIns.totalFinal !== undefined && activeIns.totalFinal !== finalPrice)) {
          updateDoc(doc(db, 'insurances', insurance.id), {
            status: targetStatus,
            totalFinal: finalPrice
          }).catch(err => console.warn('Could not auto-sync insurance status in background:', err));
        }
      }

      setLoadingPayments(true);
      const q = query(
        collection(db, 'payments'),
        where('insuranceId', '==', insurance.id),
        orderBy('date', 'desc')
      );

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Payment));
        setPayments(data);
        setLoadingPayments(false);
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'payments');
        setLoadingPayments(false);
      });

      const fetchPolicies = async () => {
        try {
          const snap = await getDocs(collection(db, 'policies'));
          setPolicies(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Policy)));
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, 'policies');
        }
      };
      fetchPolicies();

      const fetchInsuranceTypes = async () => {
        try {
          const snap = await getDocs(query(collection(db, 'insuranceTypes'), orderBy('minAge')));
          setInsuranceTypes(snap.docs.map(doc => doc.data() as any));
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, 'insuranceTypes');
        }
      };
      fetchInsuranceTypes();

      const fetchClients = async () => {
        try {
          const snap = await getDocs(collection(db, 'clients'));
          const clientMap: Record<string, any> = {};
          snap.docs.forEach(doc => {
            clientMap[doc.id] = { id: doc.id, ...doc.data() };
          });
          setClients(clientMap);
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, 'clients');
        }
      };
      fetchClients();

      const fetchAgents = async () => {
        try {
          const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'agent')));
          const agentMap: Record<string, any> = {};
          snap.docs.forEach(doc => {
            agentMap[doc.id] = { uid: doc.id, ...doc.data() };
          });
          setAgents(agentMap);
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, 'agents');
        }
      };
      fetchAgents();

      const unsubLetters = onSnapshot(collection(db, 'policyLetters'), (snap) => {
        setPolicyLetters(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as PolicyLetter)));
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'policyLetters');
      });

      const unsubCountries = onSnapshot(query(collection(db, 'countries'), orderBy('name')), (snap) => {
        setCountries(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Country)));
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'countries');
      });

      const actQuery = query(
        collection(db, 'insuranceActivities'),
        where('insuranceId', '==', insurance.id),
        orderBy('date', 'desc')
      );

      const unsubActivities = onSnapshot(actQuery, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setActivities(data);
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'activities');
      });

      return () => {
        unsubscribe();
        unsubLetters();
        unsubCountries();
        unsubActivities();
      };
    }
  }, [isOpen, insurance?.id]);

  if (!isOpen || !insurance) return null;

  const activeInsurance = localInsurance || insurance;
  const isExported = !!(activeInsurance as any)?.Caremed;
  const requestDate = activeInsurance.createdAt?.toDate ? activeInsurance.createdAt.toDate() : new Date(activeInsurance.createdAt);

  const isCancellation = activeInsurance.actionType === 'CAN';
  const multiplier = 1;

  const basePrice = activeInsurance.totalPrice || 0;
  const discountVal = activeInsurance.discount || 0;
  const adjustmentVal = activeInsurance.adjustment || 0;
  const insuranceTotalPrice = isCancellation
    ? (activeInsurance.totalPrice !== undefined && activeInsurance.totalPrice !== 0 ? activeInsurance.totalPrice : (activeInsurance.totalFinal || 0))
    : (basePrice - discountVal - adjustmentVal);

  const cardCommissionVal = activeInsurance.comision || (activeInsurance as any).cardCommission || (activeInsurance as any).cargoTarjeta || 0;
  const displayCardCommission = cardCommissionVal * multiplier;
  const displayTotalPrice = insuranceTotalPrice * multiplier;
  const displayTotalCost = (activeInsurance.totalCost || 0) * multiplier;
  const displayAgentCommission = (activeInsurance.agentCommission || 0) * multiplier;
  const displayTotalPaid = (activeInsurance.totalPaid || 0) * multiplier;
  const displayPendingBalance = displayTotalPrice - displayTotalPaid;

  const formatValue = (val: number) => {
    const isNeg = val < 0 || (isCancellation && val === 0) || Object.is(val, -0);
    const formatted = Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${isNeg ? '-' : ''}$${formatted}`;
  };

  const clientPayments = payments.filter(p => p.type === 'client_payment' || p.type === 'provider_payment');
  const completedCommissions = payments.filter(p => p.type === 'agent_commission' && p.status === 'completed');
  const pendingCommissions = payments.filter(p => p.type === 'agent_commission' && p.status === 'pending');

  const handleConfirmPayment = async (paymentId: string) => {
    if (isInsuranceClosed(localInsurance || insurance)) {
      alert('Este registro está cerrado y no se puede modificar.');
      return;
    }
    try {
      const payRef = doc(db, 'payments', paymentId);
      await updateDoc(payRef, {
        status: 'completed',
        date: new Date()
      });

      // Recalculate totalPaid for insurance
      if (insurance.id) {
        const insRef = doc(db, 'insurances', insurance.id);
        const qAll = query(collection(db, 'payments'), where('insuranceId', '==', insurance.id), where('status', '==', 'completed'));
        const allSnap = await getDocs(qAll);
        const newTotalPaid = allSnap.docs.reduce((acc, d) => {
          const data = d.data();
          return acc + (data.type === 'client_payment' ? (data.amount || 0) : 0);
        }, 0);

        const totalPrice = insurance.totalFinal || insurance.totalPrice;
        let newStatus = insurance.status;
        if ((totalPrice - newTotalPaid) <= 5) {
          newStatus = 'paid';
        } else if (newTotalPaid > 0) {
          newStatus = 'partially_paid';
        }

        await updateDoc(insRef, {
          totalPaid: newTotalPaid,
          status: newStatus
        });

        // Trigger automatic WhatsApp notifications based on status
        try {
          const updatedIns = { ...insurance, status: newStatus, totalPaid: newTotalPaid };
          if (newStatus === 'paid') {
            triggerWhatsAppNotification('estado_poliza', updatedIns);
          } else if (newStatus === 'partially_paid') {
            triggerWhatsAppNotification('recordatorio_pago', updatedIns);
          }
        } catch (waErr) {
          console.error("Error triggering WhatsApp from InsuranceDetailModal:", waErr);
        }

        // Log activity: Pago confirmado
        try {
          const amt = payments.find(p => p.id === paymentId)?.amount || 0;
          await logInsuranceActivity({
            insuranceId: insurance.id,
            type: 'automatic',
            description: `Se confirmó un pago del asegurado por $${amt.toLocaleString('es-MX', { minimumFractionDigits: 2 })} USD. El saldo pagado total ahora es de $${newTotalPaid.toLocaleString('es-MX', { minimumFractionDigits: 2 })} USD con estado general de la póliza: "${newStatus === 'paid' ? 'Pagada' : 'Parcialmente Pagada'}".`,
            date: new Date(),
            createdBy: auth.currentUser?.email || 'Sistema'
          });
        } catch (e) {
          console.error("Error logging payment confirmation:", e);
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'confirm payment');
    }
  };

  const handleConfirmCommission = async (paymentId: string) => {
    if (isInsuranceClosed(localInsurance || insurance)) {
      alert('Este registro está cerrado y no se puede modificar.');
      return;
    }
    try {
      const payRef = doc(db, 'payments', paymentId);
      const updateData: any = {
        status: 'completed',
        date: new Date()
      };

      // If we were editing this one, use the new amount
      if (editingCommissionId === paymentId && editAmount) {
        updateData.amount = parseFloat(editAmount);
      }

      await updateDoc(payRef, updateData);

      // Also update the insurance document
      if (insurance.id) {
        const insRef = doc(db, 'insurances', insurance.id);
        const insUpdate: any = {
          commissionStatus: 'confirmed'
        };

        // If we have a new amount, update the insurance's agentCommission too
        if (updateData.amount !== undefined) {
          insUpdate.agentCommission = updateData.amount;
        }

        await updateDoc(insRef, insUpdate);

        // Log activity: Comisión confirmada
        try {
          const commAmt = updateData.amount !== undefined ? updateData.amount : (payments.find(p => p.id === paymentId)?.amount || 0);
          await logInsuranceActivity({
            insuranceId: insurance.id,
            type: 'automatic',
            description: `Se confirmó comisión del agente por $${commAmt.toLocaleString('es-MX', { minimumFractionDigits: 2 })} USD.`,
            date: new Date(),
            createdBy: auth.currentUser?.email || 'Sistema'
          });
        } catch (e) {
          console.error("Error logging commission confirmation:", e);
        }
        
        // Navigate to commissions menu with search term
        onClose();
        navigate(`/commissions?search=${insurance.firstName} ${insurance.lastName}`);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'confirm commission');
    }
  };

  const handlePrintReceipt = (payment: Payment) => {
    generateReceiptPDF(payment, insurance, settings?.logoUrl, settings?.logoUrlDark);
  };

  const handleDownloadCertificate = async () => {
    if (!insurance) return;
    
    const available = getAvailableLettersForInsurance(insurance, policyLetters, policies);
    
    if (available.length === 0) {
      setDispatchModal({
        isOpen: true,
        availableLetters: [],
        selectedLanguages: ['es'],
        sendToClient: true,
        additionalEmails: '',
        sending: false,
        status: 'idle'
      });
      return;
    }

    const sortedAvailable = sortLettersByLanguage(available);
    const preferredLangs = ['es', 'en', 'policy', 'covid'];
    const preselected = sortedAvailable
      .map(l => l.language)
      .filter(lang => preferredLangs.includes(lang));
    setDispatchModal({
      isOpen: true,
      availableLetters: sortedAvailable,
      selectedLanguages: preselected.length > 0 ? preselected : [sortedAvailable[0].language],
      sendToClient: true,
      additionalEmails: '',
      sending: false,
      status: 'idle'
    });
  };

  const handleDispatch = async () => {
    if (!insurance) return;
    
    setDispatchModal(prev => ({ ...prev, sending: true, status: 'idle' }));

    try {
      const pdfsForEmail: { filename: string; data: string }[] = [];
      const pdfsForZip: { filename: string; data: any }[] = [];
      const clientName = `${insurance.firstName} ${insurance.lastName}`;
      
      for (const lang of dispatchModal.selectedLanguages) {
        const template = dispatchModal.availableLetters.find(l => l.language === lang);
        const doc: any = await generatePDF(insurance, template, policies, settings?.logoUrl, true);
        
        const filename = `Carta_Seguro_${insurance.firstName}_${insurance.lastName}_${lang}.pdf`;
        const pdfBase64 = doc.output('datauristring').split(',')[1];
        
        pdfsForEmail.push({ filename, data: pdfBase64 });
        pdfsForZip.push({ filename, data: doc.output('blob') });
      }

      // Download logic
      if (dispatchModal.selectedLanguages.length > 1) {
        const zipBlob = await createZipFromPdfs(pdfsForZip);
        downloadBlob(zipBlob, `Cartas_Seguro_${insurance.firstName}_${insurance.lastName}.zip`);
      } else if (dispatchModal.selectedLanguages.length === 1) {
        // Find the doc again or just reuse the first element
        const template = dispatchModal.availableLetters.find(l => l.language === dispatchModal.selectedLanguages[0]);
        const doc: any = await generatePDF(insurance, template, policies, settings?.logoUrl, true);
        doc.save(`Carta_Seguro_${insurance.firstName}_${insurance.lastName}_${dispatchModal.selectedLanguages[0]}.pdf`);
      }

      // Email logic
      if (dispatchModal.sendToClient || dispatchModal.additionalEmails) {
        const to: string[] = [];
        if (dispatchModal.sendToClient && insurance.email) to.push(insurance.email);
        
        const bcc = dispatchModal.additionalEmails
          .split(/[,;]/)
          .map(e => e.trim())
          .filter(e => e.includes('@'));

        if (to.length > 0 || bcc.length > 0) {
          const policy = findPolicyPrioritized(insurance.policyId, policies);
          const policyCode = insurance.policyNumber || getPolicyNumber(policy, insurance.age) || policy?.id || insurance.policyId || '';
          const policyName = policy?.name || policy?.NombrePoliza || insurance.policyName || '';
          const policyInfo = policyCode && policyName ? `${policyCode} - ${policyName}` : (policyCode || policyName || '');

          const formatToShow = (dateVal: any) => {
            if (!dateVal) return '';
            const formatted = formatDisplayDate(dateVal);
            return formatted === '-' ? '' : formatted;
          };

          const defaultTemplate = `Hola {nombre}

Te comunicamos que tu Seguro Internacional para tu viaje ya ha sido registrado.

Los datos registrados son :

Nombre: {nombre}
Fecha de Nacimiento:  {fecha_nacimiento}
Poliza: {poliza_info}
Origen: {Pais Origen}
Destino:  {Pais Destino}
Del : {Fecha_inicio} al {Fecha_Final}

Muchas gracias por elegir a Setmex y MSI como la empresa que te dará la protección internacional durante tu experiencia en el extranjero. 

Estamos convencidos, que será la mejor experiencia de tu vida y que pondrás el nombre de México en alto durante tu viaje.

Mi Seguro Internacional estará todo el tiempo contigo para si surge  cualquier evento médico o de enfermedad no tengas ningún problema. 

Cuenta con nosotros para que te podamos orientar y ayudar en cualquier momento.

Aquí te compartimos teléfonos de emergencia  y correo electrónico.

PROVIDER: ROBIN ASSIST
Calling toll-free from within the US
Phone: (888) 505 2474

Calling from outside the US, collect calls accepted
Phone: +1 (743) 244 2474

Email: cisiassist@robinassist.com

Te anexamos tu póliza en pdf la cual podrás tenerla en tu correo electrónico e imprimir. Estas cartas que enviamos sirven para que las puedas presentar en la embajada o directamente en tu universidad como comprobante de tu seguro. Si requieres algún otro documento con todo gusto lo podemos ver. Así mismo te recuerdo que puedes consultar las condiciones de la póliza general (la cual se anexa también) y en la página de internet puedes consultar mas teléfonos e información que se te pueda solicitar, así que lo puedes ver en: www.misegurointernacional.com o nos puedes enviar un correo electrónico a info@misegurointernacional.com Te deseamos la mejor de las suertes en tu viaje.

Buen viaje y gracias por tu confianza.

El equipo Mi Seguro Internacional /SETMEX S.A. de C.V.`;

          const parsedBody = defaultTemplate
            .replace(/{nombre}/g, clientName)
            .replace(/{Nombre}/g, clientName)
            .replace(/{fecha_nacimiento}/g, formatToShow(insurance.birthDate))
            .replace(/{Fecha_nacimiento}/g, formatToShow(insurance.birthDate))
            .replace(/{poliza_info}/g, policyInfo)
            .replace(/{poliza}/g, policyInfo)
            .replace(/{Poliza}/g, policyInfo)
            .replace(/{Pais Origen}/g, getCountryName(insurance.originCountry) || 'México')
            .replace(/{origen}/g, getCountryName(insurance.originCountry) || 'México')
            .replace(/{Pais Destino}/g, getCountryName(insurance.destinationCountry) || '')
            .replace(/{destino}/g, getCountryName(insurance.destinationCountry) || '')
            .replace(/{Fecha_inicio}/g, formatToShow(insurance.startDate))
            .replace(/{fecha_inicio}/g, formatToShow(insurance.startDate))
            .replace(/{Fecha_Final}/g, formatToShow(insurance.endDate))
            .replace(/{fecha_final}/g, formatToShow(insurance.endDate));

          const subject = `Póliza de Seguro - ${clientName}`;
          
          let attachments = pdfsForEmail;
          let body = parsedBody;

          // If multiple selected, also wrap in ZIP for email for better delivery?
          // The prompt says "se cree un ZIP file y se envie", so I should probably send ZIP if > 1
          if (dispatchModal.selectedLanguages.length > 1) {
            const zipBlob = await createZipFromPdfs(pdfsForZip);
            // Convert blob to base64 for the server
            const reader = new FileReader();
            const zipBase64 = await new Promise<string>((resolve) => {
              reader.onloadend = () => {
                const base64String = (reader.result as string).split(',')[1];
                resolve(base64String);
              };
              reader.readAsDataURL(zipBlob);
            });

            attachments = [{
              filename: `Cartas_Seguro_${insurance.firstName}_${insurance.lastName}.zip`,
              data: zipBase64
            }];
          }

          const response = await fetch('/api/send-certificate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: to.length > 0 ? to : bcc.slice(0, 1),
              bcc: to.length > 0 ? bcc : bcc.slice(1),
              subject,
              body,
              pdfs: attachments
            })
          });

          if (!response.ok) {
            let errMessage = "Error al enviar el correo";
            try {
              const contentType = response.headers.get('content-type');
              if (contentType && contentType.includes('application/json')) {
                const err = await response.json();
                errMessage = err.error || errMessage;
                if (err.details) {
                  errMessage += ` (Detalles: ${err.details})`;
                }
              } else {
                const text = await response.text();
                if (text && text.length < 250) {
                  errMessage = text;
                }
              }
            } catch (e) {}
            throw new Error(errMessage);
          }
        }
      }

      // Log activity: Despacho de certificados / descarga de documentos
      try {
        const mailSent = dispatchModal.sendToClient || dispatchModal.additionalEmails;
        const desc = mailSent 
          ? `Se enviaron por correo electrónico los certificados de seguro (${dispatchModal.selectedLanguages.join(', ').toUpperCase()}) a: ${[dispatchModal.sendToClient && insurance.email, dispatchModal.additionalEmails].filter(Boolean).join(', ')}`
          : `Se descargaron los certificados de seguro (${dispatchModal.selectedLanguages.join(', ').toUpperCase()}) exitosamente.`;

        await logInsuranceActivity({
          insuranceId: insurance.id,
          type: 'automatic',
          description: desc,
          date: new Date(),
          createdBy: auth.currentUser?.email || 'Sistema'
        });
      } catch (e) {
        console.error("Error logging insurance dispatch:", e);
      }

      setDispatchModal(prev => ({ ...prev, sending: false, status: 'success' }));
      setTimeout(() => {
        setDispatchModal(prev => ({ ...prev, isOpen: false, status: 'idle' }));
      }, 1500);

    } catch (error: any) {
      console.error("Dispatch error:", error);
      setDispatchModal(prev => ({ 
        ...prev, 
        sending: false, 
        status: 'error', 
        errorMsg: error.message || "Error al procesar el envío" 
      }));
    }
  };

  const handleSaveEdit = async (paymentId: string) => {
    if (isInsuranceClosed(localInsurance || insurance)) {
      alert('Este registro está cerrado y no se puede modificar.');
      return;
    }
    try {
      const newAmount = parseFloat(editAmount);
      const payRef = doc(db, 'payments', paymentId);
      await updateDoc(payRef, {
        amount: newAmount
      });

      // Also update the insurance document to keep it in sync
      if (insurance.id) {
        const insRef = doc(db, 'insurances', insurance.id);
        await updateDoc(insRef, {
          agentCommission: newAmount
        });
      }

      setEditingCommissionId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'update commission amount');
    }
  };

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || !insurance?.id) return;
    setIsSubmittingComment(true);
    try {
      await logInsuranceActivity({
        insuranceId: insurance.id,
        type: 'manual',
        description: newComment.trim(),
        date: new Date(),
        createdBy: auth.currentUser?.email || 'Usuario'
      });
      setNewComment('');
    } catch (error) {
      console.error("Error adding activity log comment:", error);
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleSaveIDseg = async () => {
    if (!insurance?.id) return;
    if (isInsuranceClosed(localInsurance || insurance)) {
      alert('Este registro está cerrado y no se puede modificar.');
      return;
    }
    setSavingIDseg(true);
    try {
      const insRef = doc(db, 'insurances', insurance.id);
      await updateDoc(insRef, {
        IDseg: tempIDseg.trim()
      });
      setIsEditingIDseg(false);
      try {
        await logInsuranceActivity({
          insuranceId: insurance.id,
          type: 'automatic',
          description: `Se actualizó el campo IDseg a: "${tempIDseg.trim() || 'Vacío'}".`,
          date: new Date(),
          createdBy: auth.currentUser?.email || 'Sistema'
        });
      } catch (e) {
        console.error("Error logging IDseg update:", e);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'update IDseg');
    } finally {
      setSavingIDseg(false);
    }
  };

  const handleSaveInvoiceCaremed = async () => {
    if (!insurance?.id) return;
    if (isInsuranceClosed(localInsurance || insurance)) {
      alert('Este registro está cerrado y no se puede modificar.');
      return;
    }
    setSavingInvoiceCaremed(true);
    try {
      const insRef = doc(db, 'insurances', insurance.id);
      await updateDoc(insRef, {
        InvoiceCaremed: tempInvoiceCaremed.trim() || null
      });
      setIsEditingInvoiceCaremed(false);
      try {
        await logInsuranceActivity({
          insuranceId: insurance.id,
          type: 'automatic',
          description: `Se actualizó el campo Invoice CareMed a: "${tempInvoiceCaremed.trim() || 'Vacío'}".`,
          date: new Date(),
          createdBy: auth.currentUser?.email || 'Sistema'
        });
      } catch (e) {
        console.error("Error logging Invoice CareMed update:", e);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'update Invoice CareMed');
    } finally {
      setSavingInvoiceCaremed(false);
    }
  };

  const handleConfirmDiscountCommission = async () => {
    if (!insurance?.id) return;
    const currentIns = localInsurance || insurance;
    if (isInsuranceClosed(currentIns)) {
      alert('Este registro está cerrado y no se puede modificar.');
      return;
    }

    const amt = parseFloat(discountCommissionAmount);
    if (isNaN(amt) || amt <= 0) {
      alert('Por favor ingrese un monto válido mayor a 0.');
      return;
    }

    setIsSavingDiscountCommission(true);
    try {
      // 1. Create client payment (Pago de cliente)
      const clientPaymentData = {
        insuranceId: insurance.id,
        amount: amt,
        currency: 'USD' as const,
        amountMXP: amt * 20,
        exchangeRate: 20,
        type: 'client_payment' as const,
        paymentMethod: 'Descuento comision',
        status: 'completed' as const,
        date: new Date(),
        notes: discountCommissionNotes || 'Descuento de comisión aplicado automáticamente',
        createdAt: new Date()
      };
      await addDoc(collection(db, 'payments'), clientPaymentData);

      // 2. Create agent commission payment (Pago de Comisión)
      const commissionPaymentData = {
        insuranceId: insurance.id,
        amount: amt,
        currency: 'USD' as const,
        amountMXP: amt * 20,
        exchangeRate: 20,
        type: 'agent_commission' as const,
        paymentMethod: 'Descuento comision',
        status: 'completed' as const,
        date: new Date(),
        notes: discountCommissionNotes || 'Comisión compensada automáticamente por Descuento Comisión',
        createdAt: new Date()
      };
      await addDoc(collection(db, 'payments'), commissionPaymentData);

      // 3. Update the insurance totalPaid and status
      const insRef = doc(db, 'insurances', insurance.id);
      const insSnap = await getDoc(insRef);
      if (insSnap.exists()) {
        const insData = insSnap.data() as InsuranceRequest;
        const currentTotalPaid = insData.totalPaid || 0;
        const newTotalPaid = currentTotalPaid + amt;
        const totalPrice = insData.totalFinal || insData.totalPrice || 0;
        
        let newStatus = insData.status;
        if ((totalPrice - newTotalPaid) <= 5) {
          newStatus = 'paid';
        } else if (newTotalPaid > 0) {
          newStatus = 'partially_paid';
        }

        await updateDoc(insRef, {
          totalPaid: newTotalPaid,
          status: newStatus
        });
      }

      // 4. Log to bitacora
      try {
        await logInsuranceActivity({
          insuranceId: insurance.id,
          type: 'automatic',
          description: `Se aplicó descuento de comisión por $${amt.toLocaleString('es-MX', { minimumFractionDigits: 2 })} USD. Se generó Pago de Cliente y Pago de Comisión con método "Descuento comision".`,
          date: new Date(),
          createdBy: auth.currentUser?.email || 'Sistema'
        });
      } catch (logErr) {
        console.error("Error logging discount activity:", logErr);
      }

      alert('Descuento de comisión aplicado con éxito.');
      setShowDiscountCommissionModal(false);
    } catch (err) {
      console.error("Error saving discount commission:", err);
      alert('Ocurrió un error al procesar el descuento de comisión.');
    } finally {
      setIsSavingDiscountCommission(false);
    }
  };

  const getPlanLabel = (plan: string) => {
    const mapping: Record<string, string> = {
      'U6': 'U6',
      'O70': 'O70',
      'Traveler': 'Traveller',
      'Student': 'Student'
    };
    return mapping[plan] || plan;
  };

  const getInsuranceTypeLabel = (policyId: string) => {
    const policy = policies.find(p => p.id === policyId);
    if (activeInsurance.policyName) return activeInsurance.policyName;
    if (policy) return policy.name;

    let label = '';
    if (policyId.includes('Oro')) label = 'Oro';
    else if (policyId.includes('Plata')) label = 'Plata';
    else if (policyId.includes('Bronce')) label = 'Bronce';
    else return '-';

    if (policyId.toLowerCase().includes('sin')) label += ' sin deducible';
    else label += ' con deducible';
    
    return label;
  };

  const policy = policies.find(p => p.id === activeInsurance.policyId);
  const polInfo = resolvePolicyFolioAndType(activeInsurance, policies);
  const plan = activeInsurance.plan || policy?.plan || activeInsurance.policyId.split('-')[0];
  const policyName = activeInsurance.policyName || policy?.name || getInsuranceTypeLabel(activeInsurance.policyId);

  const getAgentName = () => {
    if (activeInsurance.clientId && clients[activeInsurance.clientId]) {
      const client = clients[activeInsurance.clientId];
      if (client.type === 'Agent') {
        return client.commercialName || client.legalName || activeInsurance.linkedAgentId || 'Agente';
      }
      if (activeInsurance.linkedAgentId) {
        const agent = client.linkedAgents?.find((a: any) => a.email === activeInsurance.linkedAgentId);
        if (agent) return agent.name;
      }
    }
    
    if (activeInsurance.agentId && agents[activeInsurance.agentId]) {
      return agents[activeInsurance.agentId].displayName;
    }

    return activeInsurance.linkedAgentId || 'Directo';
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h3 className="text-xl font-bold text-gray-900">Detalles del Seguro</h3>
              <span className="font-mono text-xs font-bold px-2.5 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200">
                {polInfo.folio}
              </span>
              {readOnly && (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-300 flex items-center gap-1 shadow-xs">
                  <Shield className="w-3 h-3 text-slate-500" />
                  Solo Lectura
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 font-mono mt-1 flex items-center gap-2 flex-wrap">
              <span>Folio: <strong className="text-gray-900">{polInfo.folio}</strong></span>
              <span>•</span>
              <span>Plan: <strong className="text-gray-900">{polInfo.plan}</strong></span>
              <span>•</span>
              <span>Tipo: <strong className="text-gray-900">{polInfo.tipoPoliza}</strong></span>
              <span>•</span>
              <span>ID: {insurance.id}</span>
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            {!readOnly && displayPendingBalance > 0 && !isInsuranceClosed(localInsurance || insurance) && (
              <button 
                type="button"
                onClick={() => setShowStripeModal(true)}
                className="px-3.5 py-1.5 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white text-xs font-bold rounded-xl shadow-sm flex items-center gap-1.5 transition-all cursor-pointer hover:scale-105 active:scale-95"
                title="Generar y enviar liga de pago Stripe por WhatsApp o Correo"
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>Liga Stripe</span>
              </button>
            )}
            <button 
              onClick={async () => {
                if (isCorrecting) {
                  if (window.confirm("¿Desea descartar la corrección en curso? El registro temporal creado se eliminará.")) {
                    await handleCancelCorrection();
                    onClose();
                  }
                } else {
                  onClose();
                }
              }}
              className="p-2 hover:bg-gray-200 rounded-full transition-colors cursor-pointer"
            >
              <X className="w-6 h-6 text-gray-500" />
            </button>
          </div>
        </div>
        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Tabs */}
          <div className="flex border-b border-gray-100 px-8 bg-white sticky top-0 z-10">
            <button 
              onClick={() => setActiveTab('details')}
              className={`px-6 py-4 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'details' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
            >
              <FileText className="w-4 h-4" />
              Detalles Generales
            </button>
            <button 
              onClick={() => setActiveTab('payments')}
              className={`px-6 py-4 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'payments' ? 'border-green-600 text-green-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
            >
              <CreditCard className="w-4 h-4" />
              Pagos ({clientPayments.length})
            </button>
            <button 
              onClick={() => setActiveTab('commissions')}
              className={`px-6 py-4 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'commissions' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
            >
              <Briefcase className="w-4 h-4" />
              Comisiones ({completedCommissions.length})
            </button>
            <button 
              onClick={() => setActiveTab('bitacora')}
              className={`px-6 py-4 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'bitacora' ? 'border-amber-600 text-amber-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
            >
              <History className="w-4 h-4" />
              Bitácora ({activities.length})
            </button>
          </div>

          <div className="p-8">
            {activeInsurance.isCorrected && (
              <div role="alert" className="bg-red-50 border-l-4 border-red-500 p-4 mb-6 rounded-r-xl shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 select-none animate-in fade-in duration-200">
                <div className="flex gap-3">
                  <CheckCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-red-900">Seguro Corregido</p>
                    <p className="text-xs text-red-700">Este seguro ya ha sido corregido. Se han deshabilitado las opciones de corregir y cancelar para evitar duplicaciones indefinidas.</p>
                  </div>
                </div>
              </div>
            )}

            {isInsuranceClosed(localInsurance || insurance) && (
              <div role="alert" className="bg-amber-50 border-l-4 border-amber-500 p-4 mb-6 rounded-r-xl shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 select-none animate-in fade-in duration-200">
                <div className="flex gap-3" id="insurance-closed-banner">
                  <XCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-amber-900">Registro Cerrado</p>
                    <p className="text-xs text-amber-700">Este registro se ha cerrado automáticamente por saldo $0 o diferencia menor a $5 USD. No se puede modificar ni registrar pagos o comisiones.</p>
                  </div>
                </div>
                {canManageClosedState && !readOnly && (
                  <button
                    type="button"
                    disabled={isUpdatingLock}
                    onClick={async () => {
                      try {
                        setIsUpdatingLock(true);
                        await updateDoc(doc(db, 'insurances', insurance!.id!), {
                          closed: false
                        });
                        alert('Registro abierto correctamente.');
                      } catch (err) {
                        console.error(err);
                      } finally {
                        setIsUpdatingLock(false);
                      }
                    }}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-black rounded-lg shadow transition-all shrink-0 cursor-pointer disabled:opacity-40"
                  >
                    {isUpdatingLock ? 'Abriendo...' : 'Abrir Registro'}
                  </button>
                )}
              </div>
            )}

            {(localInsurance || insurance)?.closed === false && (
              <div role="alert" className="bg-green-50 border-l-4 border-green-500 p-4 mb-6 rounded-r-xl shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 select-none animate-in fade-in duration-200">
                <div className="flex gap-3" id="insurance-opened-banner">
                  <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-green-900">Registro Abierto</p>
                    <p className="text-xs text-green-700 font-medium">Este registro fue abierto para modificación y puede ser modificado por administradores.</p>
                  </div>
                </div>
                {canManageClosedState && !readOnly && (
                  <button
                    type="button"
                    disabled={isUpdatingLock}
                    onClick={async () => {
                      const currentIns = localInsurance || insurance;
                      if (!currentIns) return;
                      const totalFinal = currentIns.totalFinal !== undefined && currentIns.totalFinal !== null 
                        ? currentIns.totalFinal 
                        : (currentIns.totalPrice || 0);
                      const totalPaid = currentIns.totalPaid || 0;
                      const balance = totalFinal - totalPaid;
                      const balanceIsSmall = Math.abs(balance) < 5;
                      const isCommissionPaid = !currentIns.agentCommission || currentIns.agentCommission <= 0 || currentIns.commissionStatus === 'paid';

                      if (!balanceIsSmall) {
                        alert(`No se puede cerrar el registro: El saldo pendiente es de $${balance.toFixed(2)} USD (debe ser menor a $5 USD).`);
                        return;
                      }
                      if (!isCommissionPaid) {
                        alert(`No se puede cerrar el registro: La comisión del agente de $${(currentIns.agentCommission || 0).toFixed(2)} USD aún no ha sido pagada.`);
                        return;
                      }

                      try {
                        setIsUpdatingLock(true);
                        await updateDoc(doc(db, 'insurances', insurance!.id!), {
                          closed: true
                        });
                        alert('Registro cerrado de forma permanente.');
                      } catch (err) {
                        console.error(err);
                      } finally {
                        setIsUpdatingLock(false);
                      }
                    }}
                    className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-black rounded-lg shadow transition-all shrink-0 cursor-pointer disabled:opacity-40"
                  >
                    {isUpdatingLock ? 'Cerrando...' : 'Cerrar Registro'}
                  </button>
                )}
              </div>
            )}

            {activeTab === 'details' && (
              <div>
                {isEditingAll ? (
                  <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-6 animate-in fade-in duration-200">
                    <div className="flex justify-between items-center border-b border-gray-100 pb-4">
                      <h4 className="font-bold text-gray-900 text-lg">Modificar Póliza de Seguro por Completo</h4>
                      <span className="text-xs text-indigo-600 font-bold bg-indigo-50 px-2.5 py-1 rounded-lg">Rol: {currentUserRole.toUpperCase()}</span>
                    </div>
                    
                    {isExported && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800 font-semibold shadow-sm flex items-start gap-2">
                        <span className="text-base">⚠️</span>
                        <span>Esta póliza ya ha sido exportada a CareMed. Por restricciones del sistema, los datos del asegurado y de viaje no pueden modificarse de forma directa. Como Super Administrador o Director, únicamente tiene permitido corregir y ajustar los importes y precios.</span>
                      </div>
                    )}
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Section: Personal Info */}
                      <div className="space-y-4 border border-gray-100 p-5 rounded-xl bg-gray-50/50">
                        <h5 className="font-bold text-xs text-gray-400 uppercase tracking-wider mb-2">Información del Asegurado</h5>
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">Nombre(s) *</label>
                          <input
                            type="text"
                            value={editFormData.firstName}
                            onChange={e => handleEditFormChange('firstName', e.target.value)}
                            disabled={isCorrecting || isExported}
                            className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium disabled:opacity-75 disabled:bg-gray-100"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">Apellidos *</label>
                          <input
                            type="text"
                            value={editFormData.lastName}
                            onChange={e => handleEditFormChange('lastName', e.target.value)}
                            disabled={isCorrecting || isExported}
                            className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium disabled:opacity-75 disabled:bg-gray-100"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">Correo Electrónico *</label>
                          <input
                            type="email"
                            value={editFormData.email}
                            onChange={e => handleEditFormChange('email', e.target.value)}
                            disabled={isCorrecting || isExported}
                            className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium disabled:opacity-75 disabled:bg-gray-100"
                            required
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Fecha de Nacimiento *</label>
                            <input
                              type="date"
                              value={editFormData.birthDate}
                              onChange={e => handleEditFormChange('birthDate', e.target.value)}
                              disabled={isCorrecting || isExported}
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium disabled:opacity-75 disabled:bg-gray-100"
                              required
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Sexo *</label>
                            <select
                              value={editFormData.gender}
                              onChange={e => handleEditFormChange('gender', e.target.value)}
                              disabled={isCorrecting || isExported}
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium disabled:opacity-75 disabled:bg-gray-100"
                            >
                              <option value="M">Masculino</option>
                              <option value="F">Femenino</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* Section: Travel & Policy Info */}
                      <div className="space-y-4 border border-gray-100 p-5 rounded-xl bg-gray-50/50">
                        <h5 className="font-bold text-xs text-gray-400 uppercase tracking-wider mb-2">Detalles del Viaje y Destino</h5>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">País Origen *</label>
                            <select
                              value={editFormData.originCountry}
                              onChange={e => handleEditFormChange('originCountry', e.target.value)}
                              disabled={isCorrecting || isExported}
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium disabled:opacity-75 disabled:bg-gray-100"
                            >
                              {Array.from(new Map((countries.length > 0 ? countries : COUNTRIES).map(c => [c.code, c])).values())
                                .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                                .map(c => (
                                  <option key={c.code} value={c.code}>{c.name}</option>
                                ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">País Destino *</label>
                            <select
                              value={editFormData.destinationCountry}
                              onChange={e => handleEditFormChange('destinationCountry', e.target.value)}
                              disabled={isCorrecting || isExported}
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium disabled:opacity-75 disabled:bg-gray-100"
                            >
                              {Array.from(new Map((countries.length > 0 ? countries : COUNTRIES).map(c => [c.code, c])).values())
                                .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                                .map(c => (
                                  <option key={c.code} value={c.code}>{c.name}</option>
                                ))}
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">Ciudad Destino</label>
                          <input
                            type="text"
                            value={editFormData.city || ''}
                            onChange={e => handleEditFormChange('city', e.target.value)}
                            disabled={isCorrecting || isExported}
                            className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium disabled:opacity-75 disabled:bg-gray-100"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Fecha Salida *</label>
                            <input
                              type="date"
                              value={editFormData.startDate}
                              onChange={e => handleEditFormChange('startDate', e.target.value)}
                              disabled={isCorrecting || isExported}
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium disabled:opacity-75 disabled:bg-gray-100"
                              required
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Fecha Regreso *</label>
                            <input
                              type="date"
                              value={editFormData.endDate}
                              onChange={e => handleEditFormChange('endDate', e.target.value)}
                              disabled={isCorrecting || isExported}
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium disabled:opacity-75 disabled:bg-gray-100"
                              required
                            />
                          </div>
                        </div>

                        {/* Interactive New Months & Days Specification */}
                        <div className="p-3.5 bg-indigo-50/50 rounded-xl border border-indigo-100 space-y-3">
                          <div className="flex items-center justify-between flex-wrap gap-1">
                            <div className="flex items-center gap-1.5 text-indigo-900 font-bold text-xs">
                              <Clock className="w-3.5 h-3.5 text-indigo-600" />
                              <span>Especificar Duración: Meses y Días Nuevos</span>
                            </div>
                            {editDurationBreakdown.billedMonths >= 4 && (
                              <span className="text-[10px] font-extrabold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-200">
                                Desc. 20% mensual aplicado (≥4 meses)
                              </span>
                            )}
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            {/* Meses Nuevos Input */}
                            <div>
                              <label className="block text-[11px] font-bold text-indigo-950 mb-1">
                                Meses Nuevos Facturados
                              </label>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleDurationChange('months', Math.max(0, editDurationBreakdown.billedMonths - 1))}
                                  disabled={isCorrecting || isExported || editDurationBreakdown.billedMonths <= 0}
                                  className="w-7 h-7 bg-white border border-indigo-250 rounded text-indigo-700 font-black hover:bg-indigo-100 disabled:opacity-40 flex items-center justify-center text-xs shadow-2xs"
                                >
                                  -
                                </button>
                                <input
                                  type="number"
                                  min="0"
                                  value={editDurationBreakdown.billedMonths}
                                  onChange={e => handleDurationChange('months', parseInt(e.target.value) || 0)}
                                  disabled={isCorrecting || isExported}
                                  className="w-full text-center px-2 py-1 bg-white border border-indigo-250 rounded font-bold text-indigo-900 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleDurationChange('months', editDurationBreakdown.billedMonths + 1)}
                                  disabled={isCorrecting || isExported}
                                  className="w-7 h-7 bg-white border border-indigo-250 rounded text-indigo-700 font-black hover:bg-indigo-100 disabled:opacity-40 flex items-center justify-center text-xs shadow-2xs"
                                >
                                  +
                                </button>
                              </div>
                              <span className="text-[9.5px] text-gray-500 mt-0.5 block font-medium">
                                {editDurationBreakdown.billedMonths} {editDurationBreakdown.billedMonths === 1 ? 'mes facturado' : 'meses facturados'}
                              </span>
                            </div>

                            {/* Días Nuevos Input */}
                            <div>
                              <label className="block text-[11px] font-bold text-indigo-950 mb-1">
                                Días Nuevos Adicionales
                              </label>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleDurationChange('days', Math.max(0, editDurationBreakdown.billedDays - 1))}
                                  disabled={isCorrecting || isExported || editDurationBreakdown.billedDays <= 0}
                                  className="w-7 h-7 bg-white border border-indigo-250 rounded text-indigo-700 font-black hover:bg-indigo-100 disabled:opacity-40 flex items-center justify-center text-xs shadow-2xs"
                                >
                                  -
                                </button>
                                <input
                                  type="number"
                                  min="0"
                                  max="31"
                                  value={editDurationBreakdown.billedDays}
                                  onChange={e => handleDurationChange('days', parseInt(e.target.value) || 0)}
                                  disabled={isCorrecting || isExported}
                                  className="w-full text-center px-2 py-1 bg-white border border-indigo-250 rounded font-bold text-indigo-900 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleDurationChange('days', editDurationBreakdown.billedDays + 1)}
                                  disabled={isCorrecting || isExported}
                                  className="w-7 h-7 bg-white border border-indigo-250 rounded text-indigo-700 font-black hover:bg-indigo-100 disabled:opacity-40 flex items-center justify-center text-xs shadow-2xs"
                                >
                                  +
                                </button>
                              </div>
                              <span className="text-[9.5px] text-gray-500 mt-0.5 block font-medium">
                                {editDurationBreakdown.billedDays} {editDurationBreakdown.billedDays === 1 ? 'día adicional' : 'días adicionales'}
                              </span>
                            </div>
                          </div>

                          {/* Comparison pill */}
                          <div className="p-2 bg-white rounded-lg border border-indigo-100 flex items-center justify-between text-[11px] flex-wrap gap-2">
                            <div className="text-gray-600">
                              <span className="font-semibold text-gray-500">Duración Original:</span>{' '}
                              <span className="font-mono font-bold text-gray-800">
                                {originalDurationBreakdown.days} días ({originalDurationBreakdown.billedMonths}m + {originalDurationBreakdown.billedDays}d)
                              </span>
                            </div>
                            <ArrowRight className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                            <div className="text-indigo-900">
                              <span className="font-semibold text-indigo-700">Nueva Duración:</span>{' '}
                              <span className="font-mono font-black text-indigo-800 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                                {editDurationBreakdown.days} días ({editDurationBreakdown.billedMonths}m + {editDurationBreakdown.billedDays}d)
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      {/* Section: Technical Settings */}
                      <div className="space-y-4 border border-gray-100 p-5 rounded-xl bg-gray-50/50">
                        <h5 className="font-bold text-xs text-gray-400 uppercase tracking-wider mb-2">Configuración Técnica de Póliza</h5>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="block text-xs font-semibold text-gray-600">Póliza Base (Tarifa) *</label>
                              <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded flex items-center gap-1">
                                <span>{editUserAge} años</span>
                                <span>•</span>
                                <span>Zona {editDestinationRegion}</span>
                                <span>•</span>
                                <span>{viablePolicies.length} {viablePolicies.length === 1 ? 'viable' : 'viables'}</span>
                              </span>
                            </div>
                            <select
                              value={editFormData.policyId}
                              onChange={e => handleEditFormChange('policyId', e.target.value)}
                              disabled={isCorrecting || isExported}
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium disabled:opacity-75 disabled:bg-gray-100"
                            >
                              {viablePolicies.length === 0 ? (
                                <option value="" disabled>No hay pólizas viables ({editUserAge} años, Zona {editDestinationRegion})</option>
                              ) : (
                                viablePolicies.map(p => (
                                  <option key={p.id} value={p.id}>
                                    {p.name} - {p.plan} (Zona {p.region}) {p.deductible ? '• Con deducible' : '• Sin deducible'} - ${p.pricePerDay || 0}/día
                                  </option>
                                ))
                              )}
                            </select>
                            {viablePolicies.length === 0 && (
                              <p className="text-[11px] text-amber-600 mt-1">
                                No se encontraron pólizas activas configuradas para la Zona {editDestinationRegion} y edad de {editUserAge} años.
                              </p>
                            )}
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">ID Seguro (IDseg)</label>
                            <input
                              type="text"
                              value={editFormData.IDseg}
                              onChange={e => handleEditFormChange('IDseg', e.target.value)}
                              disabled={isCorrecting || isExported}
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-mono font-bold text-indigo-700 disabled:opacity-75 disabled:bg-gray-100"
                              placeholder="IDseg12345"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Tipo de Acción *</label>
                            <select
                              value={editFormData.actionType}
                              onChange={e => handleEditFormChange('actionType', e.target.value)}
                              disabled={isCorrecting || isExported}
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium disabled:opacity-75 disabled:bg-gray-100"
                            >
                              <option value="EMI">Emisión</option>
                              <option value="CAN">Cancelación</option>
                              <option value="MOD">Modificación</option>
                              <option value="NEW">Nuevo Ingreso</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Notas Internas</label>
                            <input
                              type="text"
                              value={editFormData.notes || ''}
                              onChange={e => handleEditFormChange('notes', e.target.value)}
                              disabled={isCorrecting || isExported}
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium disabled:opacity-75 disabled:bg-gray-100"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Fecha de Solicitud</label>
                            <input
                              type="date"
                              value={editFormData.requestDate}
                              onChange={e => handleEditFormChange('requestDate', e.target.value)}
                              disabled={!isSuperAdminOrDirector || isCorrecting || isExported}
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium disabled:opacity-75 disabled:bg-gray-100 disabled:cursor-not-allowed"
                            />
                            {!isSuperAdminOrDirector && (
                              <span className="text-[10px] text-gray-400 mt-1 block">Solo el Super Administrador o Director puede modificar la fecha de solicitud.</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Section: Client & Agent Association */}
                      <div className="space-y-4 border border-blue-100 p-5 rounded-xl bg-blue-50/10 col-span-1 md:col-span-2">
                        <h5 className="font-bold text-xs text-blue-700 uppercase tracking-wider mb-2">Asociación de Cliente y Agente</h5>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Tipo de Cliente *</label>
                            <select
                              value={editFormData.clientType}
                              onChange={e => {
                                const val = e.target.value;
                                setEditFormData(prev => ({
                                  ...prev,
                                  clientType: val,
                                  clientId: '',
                                  linkedAgentId: ''
                                }));
                              }}
                              disabled={isCorrecting || isExported}
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium disabled:opacity-75 disabled:bg-gray-100"
                              required
                            >
                              <option value="Individual">Individual</option>
                              <option value="Agent">Agente / Agencia</option>
                              <option value="Corporate">Corporativo</option>
                            </select>
                          </div>

                          {editFormData.clientType !== 'Individual' && (
                            <>
                              <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">
                                  {editFormData.clientType === 'Agent' ? 'Seleccionar Agente/Agencia *' : 'Seleccionar Corporativo *'}
                                </label>
                                <select
                                  value={editFormData.clientId}
                                  onChange={e => {
                                    const val = e.target.value;
                                    setEditFormData(prev => ({
                                      ...prev,
                                      clientId: val,
                                      linkedAgentId: ''
                                    }));
                                  }}
                                  disabled={isCorrecting || isExported}
                                  className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium disabled:opacity-75 disabled:bg-gray-100"
                                  required
                                >
                                  <option value="">Seleccione...</option>
                                  {Object.values(clients)
                                    .filter(c => c.type === editFormData.clientType)
                                    .sort((a, b) => (a.commercialName || a.legalName || '').localeCompare(b.commercialName || b.legalName || '', 'es', { sensitivity: 'base' }))
                                    .map(c => (
                                      <option key={c.id} value={c.id}>
                                        {c.commercialName || c.legalName} ({c.email || ''})
                                      </option>
                                    ))}
                                </select>
                              </div>

                              <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">Agente que lo solicita</label>
                                <select
                                  value={editFormData.linkedAgentId}
                                  onChange={e => handleEditFormChange('linkedAgentId', e.target.value)}
                                  disabled={isCorrecting || isExported}
                                  className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium disabled:opacity-75 disabled:bg-gray-100"
                                >
                                  <option value="">Seleccione subagente...</option>
                                  {(() => {
                                    const selectedClientObj = clients[editFormData.clientId];
                                    if (selectedClientObj && selectedClientObj.linkedAgents) {
                                      return [...selectedClientObj.linkedAgents]
                                        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' }))
                                        .map((la: any, idx: number) => (
                                          <option key={idx} value={la.email}>
                                            {la.name} ({la.email})
                                          </option>
                                        ));
                                    }
                                    return null;
                                  })()}
                                </select>
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Section: Commercial Amounts Override */}
                      <div className="space-y-4 border border-orange-100 p-5 rounded-xl bg-orange-50/15">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <h5 className="font-bold text-xs text-orange-700 uppercase tracking-wider">Ajustes de Precios e Importes (USD)</h5>
                          <button
                            type="button"
                            onClick={() => handleRecalculatePricingDirectly()}
                            disabled={isCorrecting}
                            className="text-[11px] text-indigo-700 hover:text-indigo-900 bg-white border border-indigo-200 px-2.5 py-1 rounded-md font-bold inline-flex items-center gap-1.5 shadow-2xs hover:bg-indigo-50 transition-colors"
                            title="Recalcular precios automáticamente según las nuevas fechas/meses/días y tarifa de póliza"
                          >
                            <RefreshCw className="w-3 h-3 text-indigo-600" />
                            Recalcular Precios con Nuevos Días
                          </button>
                        </div>

                        {/* Visual Price Comparison & Adjustments Feedback */}
                        <div className="p-3 bg-white rounded-lg border border-orange-200/80 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-gray-700 flex items-center gap-1">
                              <Calculator className="w-3.5 h-3.5 text-orange-600" />
                              Resumen de Ajustes de Precio por Nueva Duración
                            </span>
                          </div>
                          
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                            <div className="p-2 bg-gray-50 rounded border border-gray-150">
                              <div className="text-[9.5px] text-gray-500 font-medium">Precio Original</div>
                              <div className="font-mono font-bold text-gray-700">${((localInsurance || insurance)?.totalPrice || 0).toFixed(2)}</div>
                            </div>
                            <div className="p-2 bg-indigo-50/60 rounded border border-indigo-150">
                              <div className="text-[9.5px] text-indigo-600 font-medium">Nuevo Precio Base</div>
                              <div className="font-mono font-bold text-indigo-900">${(editFormData.totalPrice || 0).toFixed(2)}</div>
                            </div>
                            <div className="p-2 bg-amber-50/60 rounded border border-amber-200">
                              <div className="text-[9.5px] text-amber-700 font-medium">Diferencia Base</div>
                              <div className={`font-mono font-black ${(editFormData.totalPrice - ((localInsurance || insurance)?.totalPrice || 0)) >= 0 ? 'text-amber-800' : 'text-rose-700'}`}>
                                {(editFormData.totalPrice - ((localInsurance || insurance)?.totalPrice || 0)) > 0 ? '+' : ''}
                                ${(editFormData.totalPrice - ((localInsurance || insurance)?.totalPrice || 0)).toFixed(2)}
                              </div>
                            </div>
                            <div className="p-2 bg-emerald-50/60 rounded border border-emerald-200">
                              <div className="text-[9.5px] text-emerald-700 font-medium">Total Final Nuevo</div>
                              <div className="font-mono font-black text-emerald-800">${(editFormData.totalFinal || 0).toFixed(2)}</div>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Precio Base (totalPrice)</label>
                            <input
                              type="number"
                              step="0.01"
                              value={editFormData.totalPrice}
                              onChange={e => handleEditFormChange('totalPrice', parseFloat(e.target.value) || 0)}
                              disabled={isCorrecting}
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-semibold disabled:opacity-75 disabled:bg-gray-100"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Costo Proveedor (totalCost)</label>
                            <input
                              type="number"
                              step="0.01"
                              value={editFormData.totalCost}
                              onChange={e => handleEditFormChange('totalCost', parseFloat(e.target.value) || 0)}
                              disabled={isCorrecting}
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-semibold disabled:opacity-75 disabled:bg-gray-100"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Descuento Aplicado</label>
                            <input
                              type="number"
                              step="0.01"
                              value={editFormData.discount}
                              onChange={e => handleEditFormChange('discount', parseFloat(e.target.value) || 0)}
                              disabled={isCorrecting}
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-bold text-green-600 disabled:opacity-75 disabled:bg-gray-100"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Ajuste Manual</label>
                            <input
                              type="number"
                              step="0.01"
                              value={editFormData.adjustment}
                              onChange={e => handleEditFormChange('adjustment', parseFloat(e.target.value) || 0)}
                              disabled={isCorrecting}
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-semibold disabled:opacity-75 disabled:bg-gray-100"
                            />
                          </div>
                        </div>
                        <div className={`grid ${editFormData.destinationCountry === 'MX' ? 'grid-cols-4' : 'grid-cols-3'} gap-3`}>
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1 text-[10px]">Comisión Agente</label>
                            <input
                              type="number"
                              step="0.01"
                              value={editFormData.agentCommission}
                              onChange={e => handleEditFormChange('agentCommission', parseFloat(e.target.value) || 0)}
                              disabled={isCorrecting}
                              className="w-full px-2 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white text-indigo-700 font-bold disabled:opacity-75 disabled:bg-gray-100"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1 text-[10px]">Comisión Tarjeta</label>
                            <input
                              type="number"
                              step="0.01"
                              value={editFormData.comision}
                              onChange={e => handleEditFormChange('comision', parseFloat(e.target.value) || 0)}
                              disabled={isCorrecting}
                              className="w-full px-2 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-800 font-bold disabled:opacity-75 disabled:bg-gray-100"
                            />
                          </div>
                          {editFormData.destinationCountry === 'MX' && (
                            <div>
                              <label className="block text-xs font-semibold text-gray-600 mb-1 text-[10px]">IVA (16%)</label>
                              <input
                                type="number"
                                step="0.01"
                                value={(editFormData as any).iva || 0}
                                onChange={e => handleEditFormChange('iva', parseFloat(e.target.value) || 0)}
                                disabled={isCorrecting}
                                className="w-full px-2 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white text-rose-600 font-bold disabled:opacity-75 disabled:bg-gray-100"
                              />
                            </div>
                          )}
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1 text-[10px]">Total Final</label>
                            <input
                              type="number"
                              step="0.01"
                              value={editFormData.totalFinal}
                              onChange={e => handleEditFormChange('totalFinal', parseFloat(e.target.value) || 0)}
                              disabled={isCorrecting}
                              className="w-full px-2 py-2 border border-indigo-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-indigo-50 font-bold text-indigo-950 disabled:opacity-75"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Factura Section in Full Edit */}
                      <div className="mt-4 p-4 bg-gray-50 rounded-xl border border-gray-200">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Receipt className="w-4 h-4 text-indigo-600" />
                            <span className="text-xs font-bold text-gray-800 uppercase tracking-wider">Solicitud de Factura</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="radio"
                                name="solicitudFacturaEditAll"
                                checked={!editFormData.solicitudFactura}
                                onChange={() => {
                                  handleEditFormChange('solicitudFactura', false);
                                  setSolicitudFacturaState(false);
                                }}
                                className="text-indigo-600 focus:ring-indigo-500"
                              />
                              <span className="text-xs font-medium text-gray-700">No</span>
                            </label>
                            <label className="flex items-center gap-1.5 cursor-pointer ml-3">
                              <input
                                type="radio"
                                name="solicitudFacturaEditAll"
                                checked={!!editFormData.solicitudFactura}
                                onChange={() => {
                                  handleEditFormChange('solicitudFactura', true);
                                  setSolicitudFacturaState(true);
                                  if (!facturaDataState.rfc && !facturaDataState.razonSocial) {
                                    populateFacturaFromClientProfile();
                                  }
                                }}
                                className="text-indigo-600 focus:ring-indigo-500"
                              />
                              <span className="text-xs font-bold text-indigo-700">Sí</span>
                            </label>
                          </div>
                        </div>

                        {editFormData.solicitudFactura && (
                          <div className="space-y-3 pt-2 border-t border-gray-200">
                            <div className="flex justify-between items-center">
                              <span className="text-[11px] text-gray-500">Datos fiscales para facturación electrónica:</span>
                              <button
                                type="button"
                                onClick={() => populateFacturaFromClientProfile(true)}
                                className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold underline cursor-pointer"
                              >
                                Traer datos del cliente
                              </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                              <div>
                                <label className="block text-gray-600 font-medium mb-1">RFC</label>
                                <input
                                  type="text"
                                  value={facturaDataState.rfc}
                                  onChange={e => setFacturaDataState(prev => ({ ...prev, rfc: e.target.value.toUpperCase() }))}
                                  placeholder="XAXX010101000"
                                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg font-mono uppercase bg-white focus:ring-1 focus:ring-indigo-500"
                                />
                              </div>
                              <div>
                                <label className="block text-gray-600 font-medium mb-1">Razón Social / Nombre Fiscal</label>
                                <input
                                  type="text"
                                  value={facturaDataState.razonSocial}
                                  onChange={e => setFacturaDataState(prev => ({ ...prev, razonSocial: e.target.value }))}
                                  placeholder="Nombre o Empresa S.A. de C.V."
                                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg bg-white focus:ring-1 focus:ring-indigo-500"
                                />
                              </div>
                              <div>
                                <label className="block text-gray-600 font-medium mb-1">Régimen Fiscal</label>
                                <input
                                  type="text"
                                  value={facturaDataState.regimenFiscal}
                                  onChange={e => setFacturaDataState(prev => ({ ...prev, regimenFiscal: e.target.value }))}
                                  placeholder="Ej: 601 General de Ley / 612 Físicas"
                                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg bg-white focus:ring-1 focus:ring-indigo-500"
                                />
                              </div>
                              <div>
                                <label className="block text-gray-600 font-medium mb-1">Uso de CFDI</label>
                                <input
                                  type="text"
                                  value={facturaDataState.cfdiUse}
                                  onChange={e => setFacturaDataState(prev => ({ ...prev, cfdiUse: e.target.value }))}
                                  placeholder="Ej: G03 Gastos en general / S01"
                                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg bg-white focus:ring-1 focus:ring-indigo-500"
                                />
                              </div>
                              <div>
                                <label className="block text-gray-600 font-medium mb-1">Correo para Facturación</label>
                                <input
                                  type="email"
                                  value={facturaDataState.email}
                                  onChange={e => setFacturaDataState(prev => ({ ...prev, email: e.target.value }))}
                                  placeholder="facturacion@correo.com"
                                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg bg-white focus:ring-1 focus:ring-indigo-500"
                                />
                              </div>
                              <div>
                                <label className="block text-gray-600 font-medium mb-1">Código Postal (C.P.)</label>
                                <input
                                  type="text"
                                  value={facturaDataState.zip}
                                  onChange={e => setFacturaDataState(prev => ({ ...prev, zip: e.target.value }))}
                                  placeholder="00000"
                                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg bg-white focus:ring-1 focus:ring-indigo-500"
                                />
                              </div>
                              <div className="sm:col-span-2">
                                <label className="block text-gray-600 font-medium mb-1">Dirección (Calle, número, colonia)</label>
                                <input
                                  type="text"
                                  value={facturaDataState.direccion}
                                  onChange={e => setFacturaDataState(prev => ({ ...prev, direccion: e.target.value }))}
                                  placeholder="Calle y número exterior / interior"
                                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg bg-white focus:ring-1 focus:ring-indigo-500"
                                />
                              </div>
                              <div>
                                <label className="block text-gray-600 font-medium mb-1">Ciudad</label>
                                <input
                                  type="text"
                                  value={facturaDataState.ciudad}
                                  onChange={e => setFacturaDataState(prev => ({ ...prev, ciudad: e.target.value }))}
                                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg bg-white focus:ring-1 focus:ring-indigo-500"
                                />
                              </div>
                              <div>
                                <label className="block text-gray-600 font-medium mb-1">Estado</label>
                                <input
                                  type="text"
                                  value={facturaDataState.state}
                                  onChange={e => setFacturaDataState(prev => ({ ...prev, state: e.target.value }))}
                                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg bg-white focus:ring-1 focus:ring-indigo-500"
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Form Controls */}
                    <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                      <button
                        type="button"
                        onClick={isCorrecting ? handleCancelCorrection : () => setIsEditingAll(false)}
                        disabled={savingEditAll}
                        className="px-5 py-2.5 bg-gray-100 hover:bg-gray-250 text-gray-700 font-bold text-sm rounded-xl cursor-pointer disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={isCorrecting ? handleSaveCorrection : handleSaveAllEdit}
                        disabled={savingEditAll}
                        className="px-6 py-2.5 bg-green-600 hover:bg-green-750 text-white font-bold text-sm rounded-xl shadow-lg shadow-green-100 cursor-pointer disabled:opacity-50"
                      >
                        {savingEditAll ? 'Guardando...' : 'Guardar Cambios'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    {canManageClosedState && !readOnly && (
                      <div className="flex items-center gap-3 justify-end mb-6">
                        {activeInsurance?.actionType !== 'CAN' && !activeInsurance?.isCorrected && !activeInsurance?.isCancelled && (activeInsurance as any).Caremed && (
                          <>
                            <button
                              type="button"
                              onClick={handleDuplicateAsCancel}
                              disabled={savingEditAll}
                              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl shadow-lg shadow-red-100 transition-all cursor-pointer disabled:opacity-50"
                            >
                              <XCircle className="w-4 h-4" />
                              Cancelar
                            </button>
                            <button
                              type="button"
                              onClick={handleStartCorrection}
                              disabled={savingEditAll}
                              className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-amber-100 transition-all cursor-pointer disabled:opacity-50"
                            >
                              <History className="w-4 h-4" />
                              Corregir
                            </button>
                            <button
                              type="button"
                              onClick={handleStartExtension}
                              disabled={savingEditAll}
                              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl shadow-lg shadow-blue-100 transition-all cursor-pointer disabled:opacity-50"
                            >
                              <Plus className="w-4 h-4" />
                              Extension
                            </button>
                          </>
                        )}
                        {activeInsurance?.isCancelled && (
                          <span className="flex items-center gap-2 px-3.5 py-1.5 bg-red-50 text-red-700 text-xs font-bold rounded-xl border border-red-200">
                            <XCircle className="w-4 h-4 text-red-600" />
                            Póliza Cancelada
                          </span>
                        )}
                        {!isExported || isSuperAdminOrDirector ? (
                          <button
                            type="button"
                            onClick={() => {
                              const currentIns = localInsurance || insurance;
                              setEditFormData({
                                firstName: currentIns.firstName || '',
                                lastName: currentIns.lastName || '',
                                email: currentIns.email || '',
                                birthDate: currentIns.birthDate || '',
                                gender: currentIns.gender || 'M',
                                notes: currentIns.notes || '',
                                IDseg: currentIns.IDseg || '',
                                originCountry: currentIns.originCountry || 'MX',
                                destinationCountry: currentIns.destinationCountry || 'US',
                                city: currentIns.city || '',
                                startDate: currentIns.startDate || '',
                                endDate: currentIns.endDate || '',
                                policyId: currentIns.policyId || '',
                                requestDate: currentIns.requestDate || (currentIns.createdAt?.toDate ? format(currentIns.createdAt.toDate(), 'yyyy-MM-dd') : (currentIns.createdAt ? format(new Date(currentIns.createdAt), 'yyyy-MM-dd') : '')),
                                totalPrice: currentIns.totalPrice || 0,
                                totalCost: currentIns.totalCost || 0,
                                discount: currentIns.discount || 0,
                                adjustment: currentIns.adjustment || 0,
                                agentCommission: currentIns.agentCommission || 0,
                                comision: currentIns.comision || 0,
                                iva: currentIns.iva || 0,
                                totalFinal: currentIns.totalFinal || 0,
                                actionType: currentIns.actionType || 'NEW',
                                clientType: currentIns.clientType || 'Individual',
                                clientId: currentIns.clientId || '',
                                linkedAgentId: currentIns.linkedAgentId || '',
                                solicitudFactura: !!currentIns.solicitudFactura
                              });
                              setIsEditingAll(true);
                            }}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl shadow-lg shadow-indigo-100 transition-all cursor-pointer"
                          >
                            <Pencil className="w-4 h-4" />
                            Editar Seguro Completo
                          </button>
                        ) : (
                          <span className="text-xs text-amber-700 font-bold bg-amber-50 px-3.5 py-2 rounded-xl border border-amber-200 shadow-sm animate-pulse">
                            Póliza Exportada: Use Cancelar, Corregir o Extension para modificar. No se permite edición directa.
                          </span>
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      {/* Left Column: Client Info */}
                      <div className="space-y-6">
                        <section>
                          <div className="flex items-center gap-2 mb-4">
                            <div className="p-2 bg-blue-100 rounded-lg">
                              <User className="w-5 h-5 text-blue-600" />
                            </div>
                            <h4 className="font-bold text-gray-900 uppercase tracking-wider text-sm">Información del Asegurado</h4>
                          </div>
                          <div className="bg-gray-50 p-4 rounded-xl space-y-3 border border-gray-100">
                            <div className="flex justify-between items-center">
                              <span className="text-gray-500 text-sm font-medium">Nombre:</span>
                              <span className="font-semibold text-gray-900 flex items-center gap-1.5">
                                {activeInsurance.firstName} {activeInsurance.lastName}
                                <button
                                  type="button"
                                  onClick={() => {
                                    const isIndividual = activeInsurance.clientType === 'Individual' || (!activeInsurance.clientType && (!activeInsurance.clientId || activeInsurance.clientId === 'Individual'));
                                    const duplicatePayload = {
                                      clientType: isIndividual ? 'Individual' : (activeInsurance.clientType || 'Agent'),
                                      clientId: isIndividual ? '' : (activeInsurance.clientId || ''),
                                      linkedAgentId: activeInsurance.linkedAgentId || '',
                                      firstName: activeInsurance.firstName || '',
                                      lastName: activeInsurance.lastName || '',
                                      birthDate: activeInsurance.birthDate || '',
                                      gender: activeInsurance.gender || 'M',
                                      email: activeInsurance.email || '',
                                      originCountry: activeInsurance.originCountry || 'MX',
                                      destinationCountry: activeInsurance.destinationCountry || 'US',
                                      city: activeInsurance.city || ''
                                    };
                                    onClose();
                                    navigate('/request', { state: { duplicateData: duplicatePayload } });
                                  }}
                                  className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-all cursor-pointer inline-flex items-center"
                                  title="Duplicar datos básicos a nueva póliza (Agente/Corporativo/Individual, Nombre, Apellido, Fecha de nacimiento)"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                </button>
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500 text-sm font-medium">Email:</span>
                              <span className="font-semibold text-gray-900">{activeInsurance.email}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500 text-sm font-medium">Fecha Nacimiento:</span>
                              <span className="font-semibold text-gray-900">{activeInsurance.birthDate} ({activeInsurance.age} años)</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500 text-sm font-medium">Sexo:</span>
                              <span className="font-semibold text-gray-900">{activeInsurance.gender || '-'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500 text-sm font-medium">Canal:</span>
                              <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-bold rounded uppercase">
                                {activeInsurance.clientType}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500 text-sm font-medium">Agente:</span>
                              <span className="font-semibold text-gray-900">{getAgentName()}</span>
                            </div>
                          </div>
                        </section>

                        <section>
                          <div className="flex items-center gap-2 mb-4">
                            <div className="p-2 bg-green-100 rounded-lg">
                              <MapPin className="w-5 h-5 text-green-600" />
                            </div>
                            <h4 className="font-bold text-gray-900 uppercase tracking-wider text-sm">Destino y Ubicación</h4>
                          </div>
                          <div className="bg-gray-50 p-4 rounded-xl space-y-3 border border-gray-100">
                            <div className="flex justify-between">
                              <span className="text-gray-500 text-sm font-medium">Origen:</span>
                              <span className="font-semibold text-gray-900">{getCountryName(activeInsurance.originCountry)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500 text-sm font-medium">Destino:</span>
                              <span className="font-semibold text-gray-900">{getCountryName(activeInsurance.destinationCountry)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500 text-sm font-medium">Ciudad:</span>
                              <span className="font-semibold text-gray-900">{activeInsurance.city}</span>
                            </div>
                          </div>
                        </section>

                        <section>
                          <div className="flex items-center gap-2 mb-4">
                            <div className="p-2 bg-emerald-100 rounded-lg">
                              <Receipt className="w-5 h-5 text-emerald-600" />
                            </div>
                            <h4 className="font-bold text-gray-900 uppercase tracking-wider text-sm">Información CareMed</h4>
                          </div>
                          <div className="bg-gray-50 p-4 rounded-xl space-y-3 border border-gray-100">
                            {/* Exportación CareMed row */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-gray-500 text-sm font-medium">Exportación CareMed:</span>
                              {(activeInsurance as any).Caremed ? (
                                <div className="flex items-center gap-1.5 font-mono font-medium">
                                  <span className="font-bold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded text-xs border border-emerald-100 font-mono">
                                    {(activeInsurance as any).Caremed}
                                  </span>
                                  {isSuperAdminOrDirector && (
                                    <div className="relative flex items-center gap-1">
                                      {showConfirmClear ? (
                                        <div className="flex items-center gap-1 bg-red-50 px-1.5 py-0.5 rounded border border-red-200 text-[10px] text-red-600 font-bold">
                                          <span>¿Borrar?</span>
                                          <button
                                            onClick={async (e) => {
                                              e.stopPropagation();
                                              await handleClearExportDate();
                                              setShowConfirmClear(false);
                                            }}
                                            className="p-0.5 text-emerald-600 hover:bg-emerald-100 rounded-md transition-colors cursor-pointer"
                                            title="Confirmar Borrar"
                                          >
                                            <Check className="w-3 h-3" />
                                          </button>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setShowConfirmClear(false);
                                            }}
                                            className="p-0.5 text-gray-500 hover:bg-gray-100 rounded-md transition-colors cursor-pointer"
                                            title="Cancelar"
                                          >
                                            <X className="w-3 h-3" />
                                          </button>
                                        </div>
                                      ) : (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setShowConfirmClear(true);
                                          }}
                                          className="p-1 text-red-500 hover:bg-red-50 hover:text-red-700 rounded-md transition-colors cursor-pointer"
                                          title="Borrar Fecha de Exportación"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-gray-400 text-xs italic font-medium font-medium">No exportado</span>
                              )}
                            </div>

                            {/* Invoice CareMed row */}
                            <div className="flex justify-between items-center py-1 min-h-[32px]">
                              <span className="text-gray-500 text-sm font-medium">Invoice CareMed:</span>
                              {isEditingInvoiceCaremed ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="text"
                                    value={tempInvoiceCaremed}
                                    onChange={e => setTempInvoiceCaremed(e.target.value)}
                                    className="px-2 py-0.5 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-emerald-500 outline-none w-32 font-bold text-emerald-700 bg-emerald-50 font-mono"
                                    placeholder="Ej. INV-12345"
                                    required
                                  />
                                  <button
                                    onClick={handleSaveInvoiceCaremed}
                                    disabled={savingInvoiceCaremed}
                                    className="p-1 bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 transition-colors cursor-pointer"
                                    title="Guardar"
                                  >
                                    <Check className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => setIsEditingInvoiceCaremed(false)}
                                    className="p-1 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                                    title="Cancelar"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1 group">
                                  {activeInsurance.InvoiceCaremed ? (
                                    <span className="font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2.5 py-0.5 rounded text-xs font-mono">
                                      {activeInsurance.InvoiceCaremed}
                                    </span>
                                  ) : (
                                    <span className="text-gray-400 text-xs italic font-medium">No asignado</span>
                                  )}
                                  {!readOnly && (
                                    <button
                                      onClick={() => {
                                        setTempInvoiceCaremed(activeInsurance.InvoiceCaremed || '');
                                        setIsEditingInvoiceCaremed(true);
                                      }}
                                      className="p-1 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-md opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                                      title="Editar Invoice CareMed"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </section>

                        {/* Section: Solicitud Factura (Always editable even if closed) */}
                        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                          <div className="p-4 bg-gradient-to-r from-indigo-50/70 via-blue-50/40 to-white border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5">
                              <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-sm">
                                <Receipt className="w-4 h-4" />
                              </div>
                              <div>
                                <h4 className="font-bold text-gray-900 text-sm flex items-center gap-2">
                                  Solicitud de Factura
                                  {activeInsurance?.closed && (
                                    <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                                      Modificable en registro cerrado
                                    </span>
                                  )}
                                </h4>
                                <p className="text-[11px] text-gray-500">¿El cliente requiere comprobante fiscal / factura?</p>
                              </div>
                            </div>

                            {/* No / Sí Selector */}
                            <div className="flex items-center bg-gray-100 p-1 rounded-xl border border-gray-200">
                              <button
                                type="button"
                                onClick={() => handleToggleDetailSolicitudFactura(false)}
                                className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                                  !solicitudFacturaState
                                    ? 'bg-white text-gray-800 shadow-sm border border-gray-200/80'
                                    : 'text-gray-500 hover:text-gray-800'
                                }`}
                              >
                                No
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleDetailSolicitudFactura(true)}
                                className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                                  solicitudFacturaState
                                    ? 'bg-indigo-600 text-white shadow-sm'
                                    : 'text-gray-500 hover:text-indigo-600'
                                }`}
                              >
                                Sí
                              </button>
                            </div>
                          </div>

                          <div className="p-4">
                            {!solicitudFacturaState ? (
                              <div className="flex items-center justify-between text-xs text-gray-500 bg-gray-50 p-3 rounded-xl border border-dashed border-gray-200">
                                <div className="flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full bg-gray-400"></div>
                                  <span>No se ha solicitado factura para este seguro.</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleToggleDetailSolicitudFactura(true)}
                                  className="text-indigo-600 hover:text-indigo-800 font-bold underline cursor-pointer"
                                >
                                  Activar Factura
                                </button>
                              </div>
                            ) : (
                              <div className="space-y-4">
                                <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-blue-50/60 rounded-xl border border-blue-100 text-xs">
                                  <span className="text-blue-900 font-medium">
                                    Datos fiscales para emisión de factura:
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => populateFacturaFromClientProfile(true)}
                                    className="flex items-center gap-1 text-indigo-700 hover:text-indigo-900 font-bold underline cursor-pointer"
                                    title="Sobrescribir con los datos del perfil del cliente"
                                  >
                                    <RefreshCw className="w-3 h-3" />
                                    Cargar datos del Cliente
                                  </button>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                                  <div>
                                    <label className="block text-gray-700 font-bold mb-1">RFC *</label>
                                    <input
                                      type="text"
                                      value={facturaDataState.rfc}
                                      onChange={e => setFacturaDataState(prev => ({ ...prev, rfc: e.target.value.toUpperCase() }))}
                                      placeholder="XAXX010101000"
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono uppercase bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-gray-700 font-bold mb-1">Razón Social / Nombre Fiscal *</label>
                                    <input
                                      type="text"
                                      value={facturaDataState.razonSocial}
                                      onChange={e => setFacturaDataState(prev => ({ ...prev, razonSocial: e.target.value }))}
                                      placeholder="Nombre completo o Empresa S.A. de C.V."
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-gray-700 font-bold mb-1">Régimen Fiscal</label>
                                    <input
                                      type="text"
                                      value={facturaDataState.regimenFiscal}
                                      onChange={e => setFacturaDataState(prev => ({ ...prev, regimenFiscal: e.target.value }))}
                                      placeholder="Ej: 601 General / 612 Personas Físicas"
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-gray-700 font-bold mb-1">Uso de CFDI</label>
                                    <input
                                      type="text"
                                      value={facturaDataState.cfdiUse}
                                      onChange={e => setFacturaDataState(prev => ({ ...prev, cfdiUse: e.target.value }))}
                                      placeholder="Ej: G03 Gastos en general / S01"
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-gray-700 font-bold mb-1">Correo para Factura</label>
                                    <input
                                      type="email"
                                      value={facturaDataState.email}
                                      onChange={e => setFacturaDataState(prev => ({ ...prev, email: e.target.value }))}
                                      placeholder="facturacion@correo.com"
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-gray-700 font-bold mb-1">Código Postal (C.P.)</label>
                                    <input
                                      type="text"
                                      value={facturaDataState.zip}
                                      onChange={e => setFacturaDataState(prev => ({ ...prev, zip: e.target.value }))}
                                      placeholder="00000"
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                    />
                                  </div>
                                  <div className="sm:col-span-2">
                                    <label className="block text-gray-700 font-bold mb-1">Dirección Fiscal (Calle, número, colonia)</label>
                                    <input
                                      type="text"
                                      value={facturaDataState.direccion}
                                      onChange={e => setFacturaDataState(prev => ({ ...prev, direccion: e.target.value }))}
                                      placeholder="Calle y número exterior / interior"
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-gray-700 font-bold mb-1">Ciudad</label>
                                    <input
                                      type="text"
                                      value={facturaDataState.ciudad}
                                      onChange={e => setFacturaDataState(prev => ({ ...prev, ciudad: e.target.value }))}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-gray-700 font-bold mb-1">Estado / Provincia</label>
                                    <input
                                      type="text"
                                      value={facturaDataState.state}
                                      onChange={e => setFacturaDataState(prev => ({ ...prev, state: e.target.value }))}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                    />
                                  </div>
                                </div>

                                <div className="pt-2 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3">
                                  <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-700">
                                    <input
                                      type="checkbox"
                                      checked={updateClientProfileToo}
                                      onChange={e => setUpdateClientProfileToo(e.target.checked)}
                                      className="rounded text-indigo-600 focus:ring-indigo-500"
                                    />
                                    <span>Guardar también estos datos en el perfil del Cliente</span>
                                  </label>

                                  <div className="flex items-center gap-2">
                                    {facturaSavedSuccess && (
                                      <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 animate-fade-in">
                                        <Check className="w-3.5 h-3.5" />
                                        Guardado
                                      </span>
                                    )}
                                    {!readOnly && (
                                      <button
                                        type="button"
                                        onClick={() => handleSaveSolicitudFactura(true)}
                                        disabled={savingFactura}
                                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-100 transition-all cursor-pointer disabled:opacity-50"
                                      >
                                        {savingFactura ? 'Guardando...' : 'Guardar Datos de Factura'}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </section>
                      </div>

                      {/* Right Column: Policy Info */}
                      <div className="space-y-6">
                        <section>
                          <div className="flex items-center gap-2 mb-4">
                            <div className="p-2 bg-purple-100 rounded-lg">
                              <Shield className="w-5 h-5 text-purple-600" />
                            </div>
                            <h4 className="font-bold text-gray-900 uppercase tracking-wider text-sm">Información Comercial</h4>
                          </div>
                          <div className="bg-gray-50 p-4 rounded-xl space-y-3 border border-gray-100">
                            <div className="flex justify-between">
                              <span className="text-gray-500 text-sm font-medium">Plan:</span>
                              <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-bold rounded uppercase">
                                {getPlanLabel(plan)}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500 text-sm font-medium">Tipo de Póliza:</span>
                              <span className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase border ${
                                policyName.includes('Oro') ? 'bg-amber-50 text-amber-700 border-amber-100' :
                                policyName.includes('Plata') ? 'bg-slate-100 text-slate-700 border-slate-200' :
                                policyName.includes('Bronce') ? 'bg-orange-50 text-orange-700 border-orange-100' :
                                'bg-gray-50 text-gray-600 border-gray-200'
                              }`}>
                                {policyName}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500 text-sm font-medium">Fecha Solicitud:</span>
                              <span className="font-semibold text-gray-900">{format(requestDate, 'dd/MM/yyyy HH:mm')}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500 text-sm font-medium">Tipo de Acción:</span>
                              <span className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase border ${
                                (activeInsurance.actionType || 'NEW').toUpperCase() === 'NEW' ? 'bg-green-50 text-green-700 border-green-200' :
                                (activeInsurance.actionType || 'NEW').toUpperCase() === 'COR' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                                (activeInsurance.actionType || 'NEW').toUpperCase() === 'CAN' ? 'bg-red-50 text-red-700 border-red-200' :
                                (activeInsurance.actionType || 'NEW').toUpperCase() === 'EXT' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                'bg-gray-50 text-gray-700 border-gray-200'
                              }`}>
                                {activeInsurance.actionType === 'CAN' ? 'Cancelación' : 
                                 activeInsurance.actionType === 'COR' ? 'Corrección' : 
                                 activeInsurance.actionType === 'NEW' ? 'Nuevo' : 
                                 activeInsurance.actionType === 'EXT' ? 'Extra' : 
                                 activeInsurance.actionType === 'MOD' ? 'Modificación' : 
                                 activeInsurance.actionType === 'EMI' ? 'Emisión' : 
                                 activeInsurance.actionType || 'Emisión'}
                              </span>
                            </div>
                            <div className="flex justify-between items-center min-h-[32px]">
                              <span className="text-gray-500 text-sm font-medium">IDseg (ID Seguro):</span>
                              {isEditingIDseg ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="text"
                                    value={tempIDseg}
                                    onChange={e => setTempIDseg(e.target.value)}
                                    className="px-2 py-0.5 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none w-32 font-bold text-indigo-700 bg-indigo-50"
                                    placeholder="Ej. IDseg12345"
                                    required
                                  />
                                  <button
                                    onClick={handleSaveIDseg}
                                    disabled={savingIDseg}
                                    className="p-1 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors"
                                    title="Guardar"
                                  >
                                    <Check className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => setIsEditingIDseg(false)}
                                    className="p-1 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                                    title="Cancelar"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1 group">
                                  <span className="font-bold text-indigo-600 font-mono">{activeInsurance.IDseg || 'No asignado'}</span>
                                  {!readOnly && !(activeInsurance as any).Caremed && (
                                    <button
                                      onClick={() => {
                                        setTempIDseg(activeInsurance.IDseg || '');
                                        setIsEditingIDseg(true);
                                      }}
                                      className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                                      title="Asignar / Editar IDseg"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500 text-sm font-medium">Vigencia:</span>
                              <span className="font-semibold text-gray-900">{activeInsurance.startDate} al {activeInsurance.endDate}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500 text-sm font-medium">Duración:</span>
                              <span className="font-semibold text-gray-900">
                                {activeInsurance.days} días
                                {(() => {
                                  const d = activeInsurance.days || 0;
                                  if (d <= 0) return '';
                                  const calcMonths = Math.floor(d / 30.4);
                                  const addDays = Math.max(0, d - Math.round(calcMonths * 30.4));
                                  let bMonths = calcMonths;
                                  let bDays = addDays;
                                  if (addDays > 15) {
                                    bMonths = calcMonths + 1;
                                    bDays = 0;
                                  }
                                  if (bMonths === 0 && bDays === 0) return '';
                                  return ` (${bMonths > 0 ? `${bMonths} ${bMonths === 1 ? 'mes' : 'meses'}` : ''}${bMonths > 0 && bDays > 0 ? ' + ' : ''}${bDays > 0 ? `${bDays} ${bDays === 1 ? 'día' : 'días'}` : ''})`;
                                })()}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500 text-sm font-medium">Estado:</span>
                              {(() => {
                                const displayStatus = getInsuranceDisplayStatus(activeInsurance);

                                return (
                                  <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${
                                    displayStatus === 'paid' ? 'bg-green-100 text-green-700 border-green-200' : 
                                    displayStatus === 'pending' ? 'bg-yellow-100 text-yellow-700 border-yellow-200' : 
                                    displayStatus === 'partially_paid' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                                    'bg-red-100 text-red-700 border-red-200'
                                  }`}>
                                    {displayStatus === 'paid' ? 'PAGADO' : displayStatus === 'partially_paid' ? 'PAGO PARCIAL' : displayStatus === 'pending' ? 'PENDIENTE' : 'CANCELADO'}
                                  </span>
                                );
                              })()}
                            </div>
                          </div>
                        </section>

                        <section>
                          <div className="flex items-center gap-2 mb-4">
                            <div className="p-2 bg-yellow-100 rounded-lg">
                              <DollarSign className="w-5 h-5 text-yellow-600" />
                            </div>
                            <h4 className="font-bold text-gray-900 uppercase tracking-wider text-sm">Resumen Financiero</h4>
                          </div>
                          <div className="bg-gray-50 p-4 rounded-xl space-y-3 border border-gray-100">
                            <div className="flex justify-between">
                              <span className="text-gray-500 text-sm font-medium">Precio Base:</span>
                              <span className="font-semibold text-gray-900">{formatValue(activeInsurance.totalPrice || 0)} USD</span>
                            </div>
                            {activeInsurance.discount ? (
                              <div className="flex justify-between">
                                <span className="text-gray-500 text-sm font-medium">Descuento:</span>
                                <span className="font-bold text-green-600">{formatValue(-(activeInsurance.discount || 0))} USD</span>
                              </div>
                            ) : null}
                            {activeInsurance.adjustment ? (
                              <div className="flex justify-between">
                                <span className="text-gray-500 text-sm font-medium">Ajuste:</span>
                                <span className={`font-bold ${(activeInsurance.adjustment || 0) > 0 ? 'text-green-600' : 'text-blue-600'}`}>
                                  {formatValue(-(activeInsurance.adjustment || 0))} USD
                                </span>
                              </div>
                            ) : null}
                            {displayCardCommission > 0 ? (
                              <div className="flex justify-between">
                                <span className="text-gray-500 text-sm font-medium">Comisión Tarjeta:</span>
                                <span className="font-bold text-amber-600">{formatValue(displayCardCommission)} USD</span>
                              </div>
                            ) : null}
                            {activeInsurance.iva ? (
                              <div className="flex justify-between">
                                <span className="text-gray-500 text-sm font-medium">IVA (16%):</span>
                                <span className="font-bold text-rose-600">{formatValue(activeInsurance.iva)} USD</span>
                              </div>
                            ) : null}
                            <div className="flex justify-between">
                              <span className="text-gray-500 text-sm font-medium">Venta Total:</span>
                              <span className="font-bold text-gray-900">{formatValue(displayTotalPrice)} USD</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500 text-sm font-medium">Costo Proveedor:</span>
                              <span className="font-bold text-red-600">{formatValue(displayTotalCost)} USD</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500 text-sm font-medium">Comisión Agente:</span>
                              <span className="font-bold text-indigo-600">{formatValue(displayAgentCommission)} USD</span>
                            </div>
                            <div className="flex justify-between pt-2 border-t border-gray-200">
                              <span className="text-gray-700 font-bold">Total Pagado:</span>
                              <span className="font-bold text-green-600">{formatValue(displayTotalPaid)} USD</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-700 font-bold">Saldo Pendiente:</span>
                              <span className="font-bold text-orange-600">
                                {formatValue(displayPendingBalance)} USD
                              </span>
                            </div>
                            {displayPendingBalance >= 3 && !isInsuranceClosed(localInsurance || insurance) && (
                              <div className="pt-3 border-t border-gray-100 mt-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const pending = displayPendingBalance > 0 ? displayPendingBalance : 0;
                                    setDiscountCommissionAmount(pending.toFixed(2));
                                    setDiscountCommissionNotes('');
                                    setShowDiscountCommissionModal(true);
                                  }}
                                  className="w-full py-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-sm rounded-xl transition-all border border-indigo-200 flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                                >
                                  <Percent className="w-4 h-4 text-indigo-600" />
                                  Descuento Comisión
                                </button>
                              </div>
                            )}


                          </div>
                        </section>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'payments' && (
              <div className="space-y-6">
                {/* Grid de Métricas con Saldo Pendiente */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-emerald-50 p-5 rounded-2xl border border-emerald-100 shadow-sm transition-all hover:shadow-md">
                    <p className="text-xs text-emerald-600 font-bold uppercase mb-1 tracking-wider">Total Cobrado</p>
                    <p className="text-2xl sm:text-3xl font-extrabold text-emerald-700">{formatValue(displayTotalPaid)} USD</p>
                  </div>
                  <div className="bg-blue-50 p-5 rounded-2xl border border-blue-100 shadow-sm transition-all hover:shadow-md">
                    <p className="text-xs text-blue-600 font-bold uppercase mb-1 tracking-wider">Venta Total</p>
                    <p className="text-2xl sm:text-3xl font-extrabold text-blue-700">{formatValue(displayTotalPrice)} USD</p>
                  </div>
                  <div className={`p-5 rounded-2xl border shadow-sm transition-all hover:shadow-md ${displayPendingBalance >= 3 ? 'bg-amber-50 border-amber-100' : displayPendingBalance < -0.01 ? 'bg-blue-50 border-blue-100' : 'bg-gray-50 border-gray-100'}`}>
                    <p className={`text-xs font-bold uppercase mb-1 tracking-wider ${displayPendingBalance >= 3 ? 'text-amber-600' : displayPendingBalance < -0.01 ? 'text-blue-600' : 'text-gray-500'}`}>
                      {displayPendingBalance < -0.01 ? 'Sobrepago a Favor' : 'Saldo Pendiente'}
                    </p>
                    <p className={`text-2xl sm:text-3xl font-extrabold ${displayPendingBalance >= 3 ? 'text-amber-700' : displayPendingBalance < -0.01 ? 'text-blue-700' : 'text-gray-600'}`}>
                      {displayPendingBalance < -0.01 ? `+$${Math.abs(displayPendingBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD` : `${formatValue(displayPendingBalance)} USD`}
                    </p>
                  </div>
                </div>

                {/* Banner y Botón de Reembolso cuando el sobrepago es mayor a $5 */}
                {displayPendingBalance < -5 && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4.5 bg-gradient-to-r from-blue-50 via-indigo-50/50 to-blue-50 rounded-2xl border border-blue-200 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-blue-600 text-white rounded-xl shadow-xs shrink-0">
                        <RotateCcw className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-bold text-blue-900 uppercase tracking-wider">Saldo de Sobrepago Detectado</p>
                          <span className="px-2.5 py-0.5 bg-blue-200 text-blue-800 text-[10px] font-black rounded-full">
                            +${Math.abs(displayPendingBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                          </span>
                        </div>
                        <p className="text-xs text-blue-700 mt-0.5">
                          El asegurado cuenta con un saldo de sobrepago superior a $5.00 USD. Puedes dar de alta un reembolso por la cantidad de sobrepago.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setShowRefundModal(true)}
                      className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-blue-200 flex items-center gap-2 cursor-pointer whitespace-nowrap hover:scale-[1.02] active:scale-95"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Dar de Alta Reembolso (${Math.abs(displayPendingBalance).toFixed(2)} USD)
                    </button>
                  </div>
                )}

                {/* Active Stripe payment link banner if exists */}
                {activeInsurance.stripePaymentLink && (
                  <div className="p-3.5 bg-gradient-to-r from-indigo-50/80 via-blue-50/50 to-indigo-50 border border-indigo-200/90 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-2xs">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="p-2.5 bg-indigo-600 text-white rounded-xl shadow-xs shrink-0">
                        <CreditCard className="w-4.5 h-4.5" />
                      </div>
                      <div className="overflow-hidden">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black text-indigo-900 uppercase tracking-widest">Liga de Pago Stripe Activa</span>
                          <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 text-[9px] font-bold rounded-md">Vigente</span>
                        </div>
                        <span className="font-mono text-indigo-700 text-xs truncate block max-w-md select-all mt-0.5">{activeInsurance.stripePaymentLink}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(activeInsurance.stripePaymentLink!);
                          alert("¡Liga de pago copiada al portapapeles!");
                        }}
                        className="px-3 py-1.5 bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-bold rounded-xl transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
                        title="Copiar liga"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copiar
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowStripeModal(true)}
                        className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-indigo-100 cursor-pointer flex items-center gap-1.5 hover:scale-[1.02]"
                      >
                        <CreditCard className="w-3.5 h-3.5" />
                        Gestionar / Enviar
                      </button>
                    </div>
                  </div>
                )}

                {/* Acciones de Cobro Re-diseñadas para evitar encimamiento o desbordamiento */}
                {((insurance.totalPaid || 0) < insuranceTotalPrice) && !isInsuranceClosed(localInsurance || insurance) && !readOnly && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100 shadow-inner">
                    <div className="space-y-0.5">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Acciones de Cobro Disponibles</p>
                      <p className="text-[11px] text-slate-400">Registra abonos, aplica compensaciones o genera ligas de cobro para el asegurado.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2.5">
                      {/* El boton de % Descuento de comision solo sera visible cuando haya un saldo en el seguro. Si ya esta pagado en su totalidad o con un saldo menor a $3usd, este boton no sera visible. */}
                      {displayPendingBalance >= 3 && (
                        <button 
                          onClick={() => {
                            const pending = displayPendingBalance > 0 ? displayPendingBalance : 0;
                            setDiscountCommissionAmount(pending.toFixed(2));
                            setDiscountCommissionNotes('');
                            setShowDiscountCommissionModal(true);
                          }}
                          className="px-4 py-2.5 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-700 transition-all shadow-md shadow-indigo-100 flex items-center gap-1.5 cursor-pointer hover:scale-[1.02] active:scale-95"
                        >
                          <Percent className="w-3.5 h-3.5" />
                          Descuento Comisión
                        </button>
                      )}

                      <button 
                        type="button"
                        onClick={() => setShowStripeModal(true)}
                        className="px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-indigo-100 flex items-center gap-1.5 cursor-pointer hover:scale-[1.02] active:scale-95"
                        title="Enviar Liga de Pago Stripe por WhatsApp o Correo"
                      >
                        <CreditCard className="w-3.5 h-3.5" />
                        Enviar Liga Stripe
                      </button>

                      <button 
                        onClick={() => setShowTransactionModal(true)}
                        className="px-4 py-2.5 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-700 transition-all shadow-md shadow-blue-100 flex items-center gap-1.5 cursor-pointer hover:scale-[1.02] active:scale-95"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Registrar Pago
                      </button>
                    </div>
                  </div>
                )}

                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                  <table className="w-full text-left">
                    <thead className="bg-gray-50 text-gray-500 text-[10px] uppercase tracking-wider">
                      <tr>
                        <th className="px-6 py-4 font-bold">Fecha</th>
                        <th className="px-6 py-4 font-bold">Tipo</th>
                        <th className="px-6 py-4 font-bold">Recibo</th>
                        <th className="px-6 py-4 font-bold">Método</th>
                        <th className="px-6 py-4 font-bold text-right">Monto</th>
                        <th className="px-6 py-4 font-bold text-center">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {loadingPayments ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-12 text-center">
                            <div className="flex flex-col items-center gap-2">
                              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                              <span className="text-sm text-gray-500 font-medium">Cargando transacciones...</span>
                            </div>
                          </td>
                        </tr>
                      ) : clientPayments.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-12 text-center">
                            <div className="flex flex-col items-center gap-2 text-gray-400">
                              <Receipt className="w-12 h-12 opacity-20" />
                              <span className="text-sm font-medium">No hay pagos registrados</span>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        clientPayments.map((p) => (
                          <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-6 py-4 text-sm text-gray-600 font-medium">
                              {formatDisplayDate(p.date)}
                            </td>
                            <td className="px-6 py-4">
                              {(() => {
                                const isRefund = p.amount < 0 || String(p.notes || '').toLowerCase().includes('reembolso');
                                return (
                                  <span className={`px-2 py-1 text-[10px] font-bold rounded uppercase border ${
                                    isRefund ? 'bg-purple-50 text-purple-700 border-purple-200' :
                                    p.type === 'client_payment' ? 'bg-green-50 text-green-700 border-green-100' :
                                    'bg-red-50 text-red-700 border-red-100'
                                  }`}>
                                    {isRefund ? 'Reembolso' : p.type === 'client_payment' ? 'Cobro Cliente' : 'Pago Proveedor'}
                                  </span>
                                );
                              })()}
                            </td>
                            <td className="px-6 py-4 text-sm font-bold text-gray-500">
                              {p.receiptNumber || '-'}
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-600">
                              {p.paymentMethod || '-'}
                            </td>
                            <td className="px-6 py-4 text-right">
                              {(() => {
                                const isRefund = p.amount < 0 || String(p.notes || '').toLowerCase().includes('reembolso');
                                return (
                                  <span className={`text-sm font-bold ${
                                    isRefund ? 'text-purple-600' :
                                    p.type === 'client_payment' ? 'text-green-600' : 'text-red-600'
                                  }`}>
                                    {p.amount < 0 ? `-$${Math.abs(p.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `$${p.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} {p.currency}
                                  </span>
                                );
                              })()}
                            </td>
                            <td className="px-6 py-4 text-center">
                              <div className="flex items-center justify-center gap-2">
                                <span className={`px-2 py-1 text-[10px] font-bold rounded-full border ${
                                  p.status === 'completed' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-yellow-100 text-yellow-700 border-yellow-200'
                                }`}>
                                  {p.status === 'completed' ? 'COMPLETADO' : 'PENDIENTE'}
                                </span>
                                {p.status === 'pending' && (
                                  <button 
                                    onClick={() => handleConfirmPayment(p.id!)}
                                    className="p-1 text-green-600 hover:bg-green-50 rounded-lg transition-all"
                                    title="Confirmar Pago"
                                  >
                                    <CheckCircle className="w-4 h-4" />
                                  </button>
                                )}
                                <button 
                                  onClick={() => handlePrintReceipt(p)}
                                  className="p-1 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-all"
                                  title="Imprimir Recibo"
                                >
                                  <Printer className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'commissions' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-indigo-50 p-6 rounded-2xl border border-indigo-100 shadow-sm">
                    <p className="text-xs text-indigo-600 font-bold uppercase mb-1 tracking-wider">Comisión Total Generada</p>
                    <p className="text-3xl font-bold text-indigo-700">{formatValue(displayAgentCommission)} USD</p>
                  </div>
                  <div className="bg-green-50 p-6 rounded-2xl border border-green-100 shadow-sm">
                    <p className="text-xs text-green-600 font-bold uppercase mb-1 tracking-wider">Comisiones Confirmadas</p>
                    <p className="text-3xl font-bold text-green-700">
                      ${completedCommissions.reduce((sum, p) => sum + p.amount, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                    </p>
                  </div>
                </div>

                {pendingCommissions.length > 0 && (
                  <div className="space-y-4">
                    <h4 className="text-xs font-black text-orange-600 uppercase tracking-widest flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      Pendientes de Confirmar
                    </h4>
                    <div className="grid grid-cols-1 gap-3">
                      {pendingCommissions.map((p) => (
                        <div key={p.id} className="bg-white rounded-2xl border border-orange-100 p-5 flex items-center justify-between hover:shadow-md transition-all">
                          <div className="flex items-center gap-4">
                            <div className="p-3 bg-orange-50 rounded-xl">
                              <DollarSign className="w-5 h-5 text-orange-600" />
                            </div>
                            <div>
                              {editingCommissionId === p.id ? (
                                <div className="flex items-center gap-2 mb-1">
                                  <div className="relative">
                                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                                    <input 
                                      type="number"
                                      value={editAmount}
                                      onChange={(e) => setEditAmount(e.target.value)}
                                      className="w-24 pl-5 pr-2 py-1 text-sm font-bold border-2 border-orange-200 rounded-lg focus:outline-none focus:border-orange-500 transition-colors"
                                      autoFocus
                                    />
                                  </div>
                                  <button 
                                    onClick={() => handleSaveEdit(p.id!)}
                                    className="p-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-all shadow-sm"
                                    title="Guardar cambios"
                                  >
                                    <Check className="w-4 h-4" />
                                  </button>
                                  <button 
                                    onClick={() => setEditingCommissionId(null)}
                                    className="p-1.5 bg-gray-100 text-gray-500 rounded-lg hover:bg-gray-200 transition-all"
                                    title="Cancelar"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2 group mb-1">
                                  <p className="text-sm font-bold text-gray-900">${p.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {p.currency}</p>
                                  {!readOnly && (
                                    <button 
                                      onClick={() => {
                                        setEditingCommissionId(p.id!);
                                        setEditAmount(p.amount.toString());
                                      }}
                                      className="p-1 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-md opacity-0 group-hover:opacity-100 transition-all"
                                      title="Editar monto"
                                    >
                                      <Pencil className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              )}
                              <p className="text-[10px] text-gray-400 font-medium">
                                Generada el {formatDisplayDate(p.date)}
                              </p>
                            </div>
                          </div>
                          {!readOnly && (
                            <button 
                              onClick={() => handleConfirmCommission(p.id!)}
                              className="px-4 py-2 bg-orange-600 text-white rounded-xl text-xs font-bold hover:bg-orange-700 transition-all shadow-lg shadow-orange-100 flex items-center gap-2"
                            >
                              Confirmar Comisión
                              <CheckCircle className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    Historial de Comisiones
                  </h4>
                  {completedCommissions.length === 0 ? (
                    <div className="bg-gray-50 p-8 rounded-2xl border border-gray-100 text-center text-gray-400 text-sm font-medium flex flex-col items-center gap-2">
                      <Briefcase className="w-12 h-12 opacity-20" />
                      No hay comisiones confirmadas aún.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3">
                      {completedCommissions.map((p) => (
                        <div key={p.id} className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center justify-between hover:shadow-md transition-all">
                          <div className="flex items-center gap-4">
                            <div className="p-3 bg-green-50 rounded-xl">
                              <CheckCircle className="w-5 h-5 text-green-600" />
                            </div>
                            <div>
                              <p className="text-sm font-bold text-gray-900">${p.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {p.currency}</p>
                              {p.amountMXP && p.exchangeRate && (
                                <p className="text-xs text-amber-700 font-bold mt-0.5">
                                  ${p.amountMXP.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXP <span className="text-[10px] text-gray-400 font-medium">(T.C. {p.exchangeRate.toFixed(2)})</span>
                                </p>
                              )}
                              <p className="text-[10px] text-gray-400 font-medium">
                                Confirmada el {formatDisplayDate(p.date)}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-1 bg-green-100 text-green-700 text-[10px] font-bold rounded-full border border-green-200 uppercase">
                              Confirmada
                            </span>
                            <button 
                              onClick={() => {
                                onClose();
                                navigate(`/commissions?search=${insurance.firstName} ${insurance.lastName}`);
                              }}
                              className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                              title="Ver en Menú de Comisiones"
                            >
                              <ArrowUpRight className="w-5 h-5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'bitacora' && (
              <div className="space-y-6">
                {/* Form to submit manual activity comments */}
                <div className="bg-white rounded-2xl border border-gray-150 p-6 shadow-sm">
                  <h4 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-amber-500" />
                    Registrar Observación / Comentario en Bitácora
                  </h4>
                  <form onSubmit={handleSubmitComment} className="space-y-3">
                    <textarea
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder="Escriba aquí observaciones de llamadas, aclaraciones con el asegurado, estados especiales, etc. Por seguridad de auditoría, estos registros son inalterables y no se pueden borrar..."
                      className="w-full p-4 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/25 focus:border-amber-500 transition-all resize-none h-24"
                      required
                    />
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={isSubmittingComment || !newComment.trim()}
                        className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-200 disabled:text-gray-400 text-white text-xs font-bold rounded-xl shadow-lg shadow-amber-50/50 transition-all flex items-center gap-2 cursor-pointer"
                      >
                        {isSubmittingComment ? (
                          <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                        ) : (
                          <Plus className="w-4 h-4" />
                        )}
                        Agregar a Bitácora
                      </button>
                    </div>
                  </form>
                </div>

                {/* Timeline Stream */}
                <div className="space-y-4">
                  <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-2 mb-2">
                    <History className="w-4 h-4 text-amber-600" />
                    Historial Completo de Actividad (Auditoría)
                  </h4>

                  {activities.length === 0 ? (
                    <div className="bg-gray-50 border border-dashed border-gray-200 p-8 rounded-2xl text-center space-y-3">
                      <Activity className="w-12 h-12 text-gray-300 mx-auto opacity-70 animate-pulse" />
                      <div className="text-gray-500 font-medium text-sm">Sin observaciones registradas todavía</div>
                      <p className="text-xs text-gray-400 max-w-md mx-auto">
                        Se emitió originalmente la solicitud de seguro para {insurance.firstName} {insurance.lastName} el día{' '}
                        {format(requestDate ? requestDate : new Date(), "dd 'de' MMMM 'de' yyyy", { locale: es })}.
                      </p>
                    </div>
                  ) : (
                    <div className="relative pl-6 space-y-6 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[2px] before:bg-gray-100">
                      {activities.map((activity) => {
                        const actDate = activity.date?.toDate ? activity.date.toDate() : (activity.date ? new Date(activity.date) : new Date());
                        return (
                          <div key={activity.id} className="relative group">
                            {/* Marker circle with icon */}
                            <div className={`absolute -left-[24px] top-1.5 p-1 rounded-full border shadow-sm ${getActivityBg(activity.description, activity.type)} z-10 transition-transform group-hover:scale-110`}>
                              {getActivityIcon(activity.description, activity.type)}
                            </div>
                            
                            <div className="bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-md transition-all space-y-2">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                                <span className="text-[10px] text-gray-400 font-mono flex items-center gap-1">
                                  <Clock className="w-3.5 h-3.5" />
                                  {format(actDate, 'dd/MM/yyyy hh:mm a', { locale: es })}
                                </span>
                                <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${
                                  activity.type === 'manual' 
                                    ? 'bg-amber-100 text-amber-700 border border-amber-200' 
                                    : 'bg-indigo-100 text-indigo-700 border border-indigo-200'
                                }`}>
                                  {activity.type === 'manual' ? 'Observación' : 'Sistema'}
                                </span>
                              </div>
                              <p className="text-sm text-gray-800 leading-relaxed font-semibold">
                                {activity.description}
                              </p>
                              <div className="flex items-center gap-1.5 text-[10px] text-gray-500 border-t border-gray-50 pt-2 font-semibold">
                                <span className="p-1 bg-gray-100 rounded-full text-gray-600">
                                  <User className="w-3 h-3" />
                                </span>
                                Registrado por: <span className="text-gray-700">{activity.createdBy || 'Sistema'}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <TransactionModal 
          isOpen={showTransactionModal}
          onClose={() => setShowTransactionModal(false)}
          insuranceId={insurance.id}
          title="Registrar Transacción"
        />

        <StripePaymentModal
          isOpen={showStripeModal}
          onClose={() => setShowStripeModal(false)}
          insurance={localInsurance || insurance}
          initialAmount={displayPendingBalance > 0 ? displayPendingBalance : undefined}
          initialCurrency={(localInsurance || insurance)?.currency === 'MXP' ? 'MXP' : 'USD'}
          defaultExchangeRate={(localInsurance || insurance)?.exchangeRate || 20.00}
        />

        <RefundModal
          isOpen={showRefundModal}
          onClose={() => setShowRefundModal(false)}
          insurance={localInsurance || insurance}
          overpaymentAmount={Math.abs(displayPendingBalance)}
        />

        <EmailModal
          isOpen={showEmailModal}
          onClose={() => setShowEmailModal(false)}
          insurance={insurance}
          policies={policies}
          policyLetters={policyLetters}
          companySettings={settings}
        />

        {showWhatsAppModal && insurance && (
          <WhatsAppPolicyLettersModal
            isOpen={showWhatsAppModal}
            onClose={() => setShowWhatsAppModal(false)}
            insurance={insurance}
            policies={policies}
            policyLetters={policyLetters}
            clients={Object.values(clients || {})}
            users={Object.values(agents || {})}
            companySettings={settings}
          />
        )}

        {showDiscountCommissionModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[210] p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-300">
              <div className="p-8 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <div>
                  <h3 className="text-xl font-black text-[#1A2138] uppercase tracking-tight">Descuento Comisión</h3>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">Registrar compensación de saldo</p>
                </div>
                <button 
                  onClick={() => setShowDiscountCommissionModal(false)}
                  className="p-2 hover:bg-gray-200 rounded-full transition-colors cursor-pointer"
                >
                  <X className="w-6 h-6 text-gray-400 hover:text-gray-600" />
                </button>
              </div>

              <div className="p-8 space-y-6 text-left">
                <div className="bg-indigo-50 p-4 rounded-2xl border border-indigo-100/50 flex items-center gap-3">
                  <div className="p-2 bg-indigo-600 text-white rounded-lg">
                    <DollarSign className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-indigo-600 uppercase tracking-wider">Saldo Pendiente Actual</p>
                    <p className="text-xl font-black text-indigo-1000">{formatValue(displayPendingBalance)} USD</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest">Monto a Aplicar (USD)</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <span className="text-gray-500 font-bold">$</span>
                      </div>
                      <input 
                        type="number"
                        step="any"
                        placeholder="0.00"
                        value={discountCommissionAmount}
                        onChange={(e) => setDiscountCommissionAmount(e.target.value)}
                        className="w-full pl-8 pr-16 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-600 outline-none transition-all"
                        required
                      />
                      <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
                        <span className="text-xs font-black text-gray-400 uppercase">USD</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest">Método de Pago</label>
                    <input 
                      type="text"
                      value="Descuento comision"
                      disabled
                      className="w-full p-3.5 bg-gray-100 border border-gray-200 rounded-2xl text-sm font-bold text-gray-500 outline-none cursor-not-allowed"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest">Notas / Justificación</label>
                    <textarea 
                      rows={3}
                      placeholder="Escriba el motivo o detalles de este descuento..."
                      value={discountCommissionNotes}
                      onChange={(e) => setDiscountCommissionNotes(e.target.value)}
                      className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-600 outline-none transition-all resize-none"
                    />
                  </div>
                </div>

                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={() => setShowDiscountCommissionModal(false)}
                    className="flex-1 py-4 bg-gray-50 border border-gray-200 hover:bg-gray-100 text-[#1A2138] font-bold rounded-2xl text-sm cursor-pointer transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={isSavingDiscountCommission || !discountCommissionAmount}
                    onClick={handleConfirmDiscountCommission}
                    className="flex-1 py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-2xl text-sm uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-indigo-100"
                  >
                    {isSavingDiscountCommission ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                        Guardando...
                      </>
                    ) : (
                      <>
                        Confirmar
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {dispatchModal.isOpen && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[200] p-4">
            <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-300">
              <div className="p-8 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <div>
                  <h3 className="text-xl font-black text-[#1A2138] uppercase tracking-tight">Generar Certificado</h3>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">Opciones de Envío</p>
                </div>
                <button 
                  onClick={() => setDispatchModal(prev => ({ ...prev, isOpen: false }))}
                  className="p-2 hover:bg-gray-200 rounded-full transition-colors"
                >
                  <X className="w-6 h-6 text-gray-400 hover:text-gray-600" />
                </button>
              </div>
              
              <div className="p-8 space-y-6">
                {dispatchModal.availableLetters.length > 0 && (
                  <div className="space-y-3">
                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest">Idiomas Disponibles</label>
                    <div className="grid grid-cols-2 gap-3">
                      {dispatchModal.availableLetters.map(letter => (
                        <button
                          key={letter.id}
                          onClick={() => {
                            const selected = dispatchModal.selectedLanguages.includes(letter.language)
                              ? dispatchModal.selectedLanguages.filter(l => l !== letter.language)
                              : [...dispatchModal.selectedLanguages, letter.language];
                            setDispatchModal(prev => ({ ...prev, selectedLanguages: selected }));
                          }}
                          className={`flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all font-bold text-sm ${
                            dispatchModal.selectedLanguages.includes(letter.language)
                              ? 'border-blue-600 bg-blue-50 text-blue-600'
                              : 'border-gray-100 bg-white text-gray-400 hover:border-gray-200'
                          }`}
                        >
                          {letter.language === 'es' ? 'Español' : 
                           letter.language === 'en' ? 'Inglés' : 
                           letter.language === 'de' ? 'Alemán' : 
                           letter.language === 'it' ? 'Italiano' : 
                           letter.language === 'fr' ? 'Francés' : 
                           letter.language === 'es_spain' ? 'España' : 
                           letter.language === 'embajada_spain' ? 'Embajada España' : 
                           letter.language === 'covid' ? 'Coronavirus' : 
                           letter.language === 'policy' ? 'Policy' : 
                           letter.language.toUpperCase()}
                          {dispatchModal.selectedLanguages.includes(letter.language) && <Check className="w-4 h-4 ml-2" />}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-4 pt-4 border-t border-gray-100">
                  <div className="flex items-center justify-between p-4 bg-blue-50/50 rounded-2xl border border-blue-100/50">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-600 text-white rounded-lg">
                        <Mail className="w-4 h-4" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-black text-[#1A2138] leading-none mb-1">Enviar al Cliente</span>
                        <span className="text-[10px] font-bold text-blue-600/70 truncate max-w-[180px]">{insurance.email}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => setDispatchModal(prev => ({ ...prev, sendToClient: !prev.sendToClient }))}
                      className={`w-12 h-6 rounded-full p-1 transition-colors ${dispatchModal.sendToClient ? 'bg-blue-600' : 'bg-gray-200'}`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-white transition-transform ${dispatchModal.sendToClient ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest">Otros Correos (BCC)</label>
                    <input 
                      type="text"
                      placeholder="ejemplo@correo.com; otro@correo.com"
                      value={dispatchModal.additionalEmails}
                      onChange={(e) => setDispatchModal(prev => ({ ...prev, additionalEmails: e.target.value }))}
                      className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-600 outline-none transition-all"
                    />
                    <p className="text-[10px] text-gray-400 font-bold italic">Séparelos con coma (,) o punto y coma (;)</p>
                  </div>
                </div>

                {dispatchModal.status === 'error' && (
                  <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                    <XCircle className="w-5 h-5 text-red-600" />
                    <p className="text-xs font-bold text-red-600 text-left">{dispatchModal.errorMsg}</p>
                  </div>
                )}

                {dispatchModal.status === 'success' && (
                  <div className="p-4 bg-green-50 border border-green-100 rounded-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                    <CheckCircle className="w-5 h-5 text-green-600" />
                    <p className="text-xs font-bold text-green-600 text-left">¡Carta generada y enviada con éxito!</p>
                  </div>
                )}

                <button
                  disabled={dispatchModal.sending || dispatchModal.selectedLanguages.length === 0}
                  onClick={handleDispatch}
                  className="w-full py-5 bg-[#1A2138] text-white rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-black transition-all shadow-xl shadow-gray-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                >
                  {dispatchModal.sending ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                      Procesando...
                    </>
                  ) : (
                    <>
                      Generar y Despachar
                      <ArrowRight className="w-5 h-5" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="p-6 bg-gray-50 border-t border-gray-100 flex justify-end gap-3 flex-wrap items-center">
          {insurance && (() => {
            const clientList = Object.values(clients || {});
            const agentList = Object.values(agents || {});
            const waContacts = getPolicyWhatsAppContacts(insurance, clientList, agentList);
            return (
              <button 
                onClick={() => setShowWhatsAppModal(true)}
                className="px-5 py-2 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 transition-all shadow-sm flex items-center gap-2 cursor-pointer hover:scale-105 active:scale-95"
                title={`Enviar cartas por WhatsApp ${waContacts.label ? `(${waContacts.label})` : ''}`}
                aria-label="Enviar por WhatsApp"
              >
                <MessageCircle className="w-4 h-4" />
                <span>WhatsApp</span>
              </button>
            );
          })()}
          <button 
            onClick={() => setShowEmailModal(true)}
            className="px-5 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 cursor-pointer"
          >
            <Mail className="w-4 h-4" />
            Enviar por Correo
          </button>
          <button 
            onClick={handleDownloadCertificate}
            className="px-5 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 cursor-pointer"
            title="Reimprimir o Descargar Certificado de la Póliza"
          >
            <Printer className="w-4 h-4" />
            Reimprimir Póliza
          </button>
          <button 
            onClick={async () => {
              if (isCorrecting) {
                if (window.confirm("¿Desea descartar la corrección en curso? El registro temporal creado se eliminará.")) {
                  await handleCancelCorrection();
                  onClose();
                }
              } else {
                onClose();
              }
            }}
            className="px-6 py-2 bg-white border border-gray-200 text-gray-700 font-bold rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cerrar
          </button>
        </div>

        {showExtensionDialog && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[200] p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200 border border-gray-100">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
                    <Plus className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-black text-[#1A2138] uppercase tracking-wider">Crear Extensión de Seguro</h3>
                </div>
                <button onClick={() => setShowExtensionDialog(false)}>
                  <XCircle className="w-6 h-6 text-gray-400 hover:text-gray-600 cursor-pointer" />
                </button>
              </div>

              <div className="p-6 space-y-5">
                <p className="text-xs text-gray-500 font-medium">
                  Se duplicará el registro de la póliza original con el tipo de acción <strong>EXT</strong>, recalculando tarifas a partir de la nueva vigencia.
                </p>

                <div className="bg-gray-50/50 border border-gray-150 rounded-xl p-4 space-y-3">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-gray-400">Cliente:</span>
                    <span className="text-gray-800 font-bold">{(localInsurance || insurance)?.firstName} {(localInsurance || insurance)?.lastName}</span>
                  </div>
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-gray-400">Plan actual:</span>
                    <span className="text-indigo-600 font-bold">{(localInsurance || insurance)?.plan || '-'}</span>
                  </div>
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-gray-400">Vigencia original:</span>
                    <span className="text-gray-600">{(localInsurance || insurance)?.startDate} al {(localInsurance || insurance)?.endDate}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black text-gray-400 uppercase tracking-wider mb-2">Fecha Inicio Extensión</label>
                    <input 
                      type="date"
                      value={getExtensionStartDate()}
                      disabled
                      className="w-full p-3.5 bg-gray-100 border border-gray-200 rounded-xl text-sm font-bold text-gray-500 outline-none cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-black text-blue-600 uppercase tracking-wider mb-2">Fecha Término Nueva</label>
                    <input 
                      type="date"
                      min={getExtensionStartDate()}
                      value={extensionEndDate}
                      onChange={(e) => setExtensionEndDate(e.target.value)}
                      className="w-full p-3.5 bg-white border border-blue-200 rounded-xl text-sm font-bold text-[#1A2138] focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                </div>

                {extensionEndDate && (
                  <div className="bg-indigo-50/30 border border-indigo-100 rounded-xl p-4 space-y-3 animate-in fade-in duration-150">
                    <h4 className="text-[10px] font-black text-indigo-600 uppercase tracking-wider mb-2">Cálculos Estimados del Nuevo Seguro</h4>
                    {(() => {
                      const pricing = calculateExtensionPricing(getExtensionStartDate(), extensionEndDate);
                      if (!pricing) return <p className="text-xs text-red-500">Error al calcular precios.</p>;
                      return (
                        <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-xs font-semibold">
                          <div className="flex justify-between border-b border-indigo-50/40 pb-1.5 col-span-2">
                            <span className="text-gray-500">Duración:</span>
                            <span className="text-gray-900 font-bold">{pricing.days} días</span>
                          </div>
                          <div className="flex justify-between border-b border-indigo-50/40 pb-1.5 col-span-2">
                            <span className="text-gray-500">Precio Base:</span>
                            <span className="text-gray-900 font-bold">${pricing.totalPrice.toFixed(2)} USD</span>
                          </div>
                          <div className="flex justify-between border-b border-indigo-50/40 pb-1.5 col-span-2">
                            <span className="text-red-400">Costo Estimado:</span>
                            <span className="text-red-600 font-bold">${pricing.totalCost.toFixed(2)} USD</span>
                          </div>
                          {pricing.discount > 0 && (
                            <div className="flex justify-between border-b border-indigo-50/40 pb-1.5 col-span-2">
                              <span className="text-gray-500">Descuento Cliente:</span>
                              <span className="text-amber-600 font-bold">-${pricing.discount.toFixed(2)} USD</span>
                            </div>
                          )}
                          <div className="flex justify-between pt-1 col-span-2">
                            <span className="text-indigo-600 font-black">Total Final Cobrado:</span>
                            <span className="text-indigo-950 font-black text-sm">${pricing.totalFinal.toFixed(2)} USD</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

              <div className="p-6 border-t border-gray-100 bg-gray-50/50 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowExtensionDialog(false)}
                  disabled={isCreatingExtension}
                  className="flex-1 py-3 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-xl transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleCreateExtension}
                  disabled={isCreatingExtension || !extensionEndDate}
                  className="flex-1 py-3 text-sm font-bold bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all disabled:opacity-50 shadow-lg shadow-blue-100 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isCreatingExtension ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                      Duplicando...
                    </>
                  ) : (
                    <>
                      Confirmar Extensión
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
