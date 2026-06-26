import React, { useState, useEffect } from 'react';
import { X, Calendar, User, Mail, MapPin, Shield, DollarSign, Clock, Briefcase, Receipt, CreditCard, FileText, Plus, CheckCircle, ArrowUpRight, Pencil, Check, Printer, ArrowRight, XCircle, History, MessageSquare, Activity, Percent, Trash2 } from 'lucide-react';
import { COUNTRIES } from '../constants';
import { collection, query, where, onSnapshot, orderBy, doc, updateDoc, getDocs, getDoc, addDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, auth } from '../firebase';
import { InsuranceRequest, Payment, Policy, PolicyLetter, Country } from '../types';
import { useNavigate } from 'react-router-dom';
import { format, parseISO, differenceInDays, differenceInYears, isValid } from 'date-fns';
import { es } from 'date-fns/locale';
import TransactionModal from './TransactionModal';
import EmailModal from './EmailModal';
import { generatePDF, generateReceiptPDF } from '../lib/pdfGenerator';
import { createZipFromPdfs, downloadBlob } from '../lib/zipUtils';
import { useCompany } from '../App';
import { triggerWhatsAppNotification } from '../services/whatsapp';

const LANGUAGE_ORDER = ['es', 'en', 'policy', 'covid', 'fr', 'it', 'de'];

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
}

export default function InsuranceDetailModal({ isOpen, onClose, insurance }: InsuranceDetailModalProps) {
  const navigate = useNavigate();
  const { settings } = useCompany();
  const [localInsurance, setLocalInsurance] = useState<InsuranceRequest | null>(insurance);
  const [currentUserRole, setCurrentUserRole] = useState<string>('none');
  const isSuperAdmin = currentUserRole === 'super_admin';
  const isSuperAdminOrDirector = currentUserRole === 'super_admin' || currentUserRole === 'director';
  const canManageClosedState = ['super_admin', 'director', 'seguros', 'administracion', 'admin'].includes(currentUserRole);
  const [showConfirmClear, setShowConfirmClear] = useState(false);

  const [isEditingAll, setIsEditingAll] = useState(false);
  const [savingEditAll, setSavingEditAll] = useState(false);
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
    totalPrice: 0,
    totalCost: 0,
    discount: 0,
    adjustment: 0,
    agentCommission: 0,
    comision: 0,
    totalFinal: 0,
    actionType: 'NEW'
  });

  const handleEditFormChange = (field: string, value: any) => {
    setEditFormData(prev => {
      const updated = { ...prev, [field]: value };
      
      const activeIns = localInsurance || insurance;
      if (!activeIns) return updated;

      // Auto-recalculate day-based pricing if startDate, endDate, or policyId is updated
      if (['startDate', 'endDate', 'policyId'].includes(field)) {
        if (updated.startDate && updated.endDate && updated.policyId) {
          try {
            const startD = parseISO(updated.startDate);
            const endD = parseISO(updated.endDate);
            const d = differenceInDays(endD, startD) + 1;
            const days = d > 0 ? d : 1;
            const months = days <= 39 ? 0 : Math.ceil(days / 30.4);
            
            // Find policy rate
            const matchedPolicy = policies.find(p => 
              p.id === updated.policyId || 
              (p.CodigoPoliza && p.CodigoPoliza === updated.policyId) ||
              p.name === updated.policyId
            );
            
            if (matchedPolicy) {
              let basePrice = 0;
              let totalCost = 0;
              if (days <= 39) {
                basePrice = (matchedPolicy.pricePerDay || 0) * days;
                totalCost = (matchedPolicy.costPerDay || 0) * days;
              } else {
                basePrice = (matchedPolicy.pricePerMonth || ((matchedPolicy.pricePerDay || 0) * 30)) * months;
                totalCost = ((matchedPolicy.costPerDay || 0) * 30) * months;
              }
              
              updated.totalPrice = Math.round(basePrice * 100) / 100;
              updated.totalCost = Math.round(totalCost * 100) / 100;

              // Recalculate discount based on client/policy discounts
              let calculatedDiscount = 0;
              if (months >= 4) {
                let policyDiscountAmount = 0;
                if (matchedPolicy.discountPercentage && matchedPolicy.discountPercentage > 0) {
                  policyDiscountAmount = Math.round((updated.totalPrice * (matchedPolicy.discountPercentage / 100)) * 100) / 100;
                }
                const priceAfterPolicyDiscount = updated.totalPrice - policyDiscountAmount;
                let clientDiscountAmount = 0;
                const client = activeIns.clientId ? clients[activeIns.clientId] : null;
                const clientDiscountPercent = client?.discountPercentage || 0;
                if (clientDiscountPercent > 0) {
                  clientDiscountAmount = Math.round((priceAfterPolicyDiscount * (clientDiscountPercent / 100)) * 100) / 100;
                }
                calculatedDiscount = Math.round((policyDiscountAmount + clientDiscountAmount) * 100) / 100;
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
      const isCard = pm === 'Tarjeta AMEX' || pm === 'Tarjeta VISA/MC';
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
          updated.agentCommission = Math.round(((base - disc - adj) * (commissionPercent / 100)) * 100) / 100;
        }
      }

      // Auto-recalculate totalFinal if physical value fields are updated
      if (['totalPrice', 'discount', 'adjustment', 'comision', 'startDate', 'endDate', 'policyId'].includes(field)) {
        const base = parseFloat(updated.totalPrice as any) || 0;
        const disc = parseFloat(updated.discount as any) || 0;
        const adj = parseFloat(updated.adjustment as any) || 0;
        const cardC = parseFloat(updated.comision as any) || 0;
        updated.totalFinal = Math.round((base - disc - adj + cardC) * 100) / 100;
      }
      return updated;
    });
  };

  const handleSaveAllEdit = async () => {
    if (!insurance?.id) return;
    setSavingEditAll(true);
    try {
      // Calculate current date difference and update age and days fields
      let computedAge = (localInsurance || insurance).age || 0;
      if (editFormData.birthDate) {
        computedAge = differenceInYears(new Date(), parseISO(editFormData.birthDate));
      }

      let computedDays = (localInsurance || insurance).days || 1;
      if (editFormData.startDate && editFormData.endDate) {
        computedDays = differenceInDays(parseISO(editFormData.endDate), parseISO(editFormData.startDate)) + 1;
      }

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
        totalPrice: parseFloat(editFormData.totalPrice as any) || 0,
        totalCost: parseFloat(editFormData.totalCost as any) || 0,
        discount: parseFloat(editFormData.discount as any) || 0,
        adjustment: parseFloat(editFormData.adjustment as any) || 0,
        agentCommission: parseFloat(editFormData.agentCommission as any) || 0,
        comision: parseFloat(editFormData.comision as any) || 0,
        totalFinal: parseFloat(editFormData.totalFinal as any) || 0,
        actionType: editFormData.actionType
      };

      await updateDoc(doc(db, 'insurances', insurance.id), updatedData);

      // Write action to activities log (bitacora)
      await addDoc(collection(db, 'insuranceActivities'), {
        insuranceId: insurance.id,
        type: 'manual',
        description: `Super Admin/Director modificó los datos de la póliza de forma completa.`,
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
  const [showDiscountCommissionModal, setShowDiscountCommissionModal] = useState(false);
  const [discountCommissionAmount, setDiscountCommissionAmount] = useState<string>('');
  const [discountCommissionNotes, setDiscountCommissionNotes] = useState<string>('');
  const [isSavingDiscountCommission, setIsSavingDiscountCommission] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
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
    const insuranceTotalPrice = activeIns.totalFinal || activeIns.totalPrice;
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
      await addDoc(collection(db, 'insuranceActivities'), {
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
  }, [insurance]);

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
        totalPrice: currentIns.totalPrice || 0,
        totalCost: currentIns.totalCost || 0,
        discount: currentIns.discount || 0,
        adjustment: currentIns.adjustment || 0,
        agentCommission: currentIns.agentCommission || 0,
        comision: currentIns.comision || 0,
        totalFinal: currentIns.totalFinal || 0,
        actionType: currentIns.actionType || 'NEW'
      });
    }
  }, [insurance?.id, localInsurance?.id, isOpen]);

  useEffect(() => {
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
  }, [insurance?.id, isOpen]);

  useEffect(() => {
    if (isOpen && insurance?.id) {
      const unsub = onSnapshot(doc(db, 'insurances', insurance.id), (docSnap) => {
        if (docSnap.exists()) {
          setLocalInsurance({ id: docSnap.id, ...docSnap.data() } as InsuranceRequest);
        }
      });
      return () => unsub();
    }
  }, [isOpen, insurance?.id]);

  const handleClearExportDate = async () => {
    const activeId = localInsurance?.id || insurance?.id;
    if (!activeId) return;
    try {
      await updateDoc(doc(db, 'insurances', activeId), {
        Caremed: ''
      });
      
      await addDoc(collection(db, 'insuranceActivities'), {
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
          console.error("Error fetching policies:", error);
        }
      };
      fetchPolicies();

      const fetchClients = async () => {
        try {
          const snap = await getDocs(collection(db, 'clients'));
          const clientMap: Record<string, any> = {};
          snap.docs.forEach(doc => {
            clientMap[doc.id] = { id: doc.id, ...doc.data() };
          });
          setClients(clientMap);
        } catch (error) {
          console.error("Error fetching clients:", error);
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
          console.error("Error fetching agents:", error);
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
        console.error("Error fetching activities:", error);
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
  const requestDate = activeInsurance.createdAt?.toDate ? activeInsurance.createdAt.toDate() : new Date(activeInsurance.createdAt);

  const isCancellation = activeInsurance.actionType === 'CAN';
  const multiplier = isCancellation ? -1 : 1;

  const insuranceTotalPrice = activeInsurance.totalFinal || activeInsurance.totalPrice;
  const displayTotalPrice = insuranceTotalPrice * multiplier;
  const displayTotalCost = (activeInsurance.totalCost || 0) * multiplier;
  const displayAgentCommission = (activeInsurance.agentCommission || 0) * multiplier;
  const displayTotalPaid = (activeInsurance.totalPaid || 0) * multiplier;
  const displayPendingBalance = displayTotalPrice - displayTotalPaid;

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
        if (newTotalPaid >= totalPrice) {
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
          await addDoc(collection(db, 'insuranceActivities'), {
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
          await addDoc(collection(db, 'insuranceActivities'), {
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
    
    // Find the actual policy document to get its consistent ID
    // Some insurance records might have CodigoPoliza or name as policyId if imported/old
    const policy = policies.find(p => 
      p.id === insurance.policyId || 
      (p.CodigoPoliza && p.CodigoPoliza === insurance.policyId) ||
      p.name === insurance.policyId
    );

    const actualPolicyId = policy ? policy.id : insurance.policyId;
    const available = policyLetters.filter(l => l.policyId === actualPolicyId);
    
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
          const policy = policies.find(p => p.id === insurance.policyId || (p.CodigoPoliza && p.CodigoPoliza === insurance.policyId) || p.name === insurance.policyId);
          const policyCode = policy?.CodigoPoliza || policy?.id || insurance.policyId || '';
          const policyName = policy?.name || policy?.NombrePoliza || insurance.policyName || '';
          const policyInfo = policyCode && policyName ? `${policyCode} - ${policyName}` : (policyCode || policyName || '');

          const formatToShow = (dateVal: any) => {
            if (!dateVal) return '';
            try {
              const parsed = parseISO(dateVal);
              if (isValid(parsed)) return format(parsed, 'dd/MM/yyyy');
              const d = new Date(dateVal);
              if (isValid(d)) return format(d, 'dd/MM/yyyy');
            } catch (e) {}
            return String(dateVal);
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
            .replace(/{Pais Origen}/g, insurance.originCountry || 'México')
            .replace(/{origen}/g, insurance.originCountry || 'México')
            .replace(/{Pais Destino}/g, insurance.destinationCountry || '')
            .replace(/{destino}/g, insurance.destinationCountry || '')
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

        await addDoc(collection(db, 'insuranceActivities'), {
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
      await addDoc(collection(db, 'insuranceActivities'), {
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
        await addDoc(collection(db, 'insuranceActivities'), {
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
        await addDoc(collection(db, 'insuranceActivities'), {
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
        if (newTotalPaid >= totalPrice) {
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
        await addDoc(collection(db, 'insuranceActivities'), {
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
            <h3 className="text-xl font-bold text-gray-900">Detalles del Seguro</h3>
            <p className="text-sm text-gray-500 font-mono">ID: {insurance.id}</p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-full transition-colors"
          >
            <X className="w-6 h-6 text-gray-500" />
          </button>
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
            {isInsuranceClosed(localInsurance || insurance) && (
              <div role="alert" className="bg-amber-50 border-l-4 border-amber-500 p-4 mb-6 rounded-r-xl shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 select-none animate-in fade-in duration-200">
                <div className="flex gap-3" id="insurance-closed-banner">
                  <XCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-amber-900">Registro Cerrado</p>
                    <p className="text-xs text-amber-700">Este registro se ha cerrado automáticamente por saldo $0 o diferencia menor a $5 USD. No se puede modificar ni registrar pagos o comisiones.</p>
                  </div>
                </div>
                {canManageClosedState && (
                  <button
                    type="button"
                    disabled={isUpdatingLock}
                    onClick={async () => {
                      if (confirm('¿Estás seguro de abrir este registro para modificación?')) {
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
                {canManageClosedState && (
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

                      if (confirm('¿Estás seguro de volver a cerrar de forma permanente este registro?')) {
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
                            className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">Apellidos *</label>
                          <input
                            type="text"
                            value={editFormData.lastName}
                            onChange={e => handleEditFormChange('lastName', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">Correo Electrónico *</label>
                          <input
                            type="email"
                            value={editFormData.email}
                            onChange={e => handleEditFormChange('email', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium"
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
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium"
                              required
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Sexo *</label>
                            <select
                              value={editFormData.gender}
                              onChange={e => handleEditFormChange('gender', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium"
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
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium"
                            >
                              {(countries.length > 0 ? countries : COUNTRIES).map(c => (
                                <option key={c.code} value={c.code}>{c.name}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">País Destino *</label>
                            <select
                              value={editFormData.destinationCountry}
                              onChange={e => handleEditFormChange('destinationCountry', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium"
                            >
                              {(countries.length > 0 ? countries : COUNTRIES).map(c => (
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
                            className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Fecha Salida *</label>
                            <input
                              type="date"
                              value={editFormData.startDate}
                              onChange={e => handleEditFormChange('startDate', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium"
                              required
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Fecha Regreso *</label>
                            <input
                              type="date"
                              value={editFormData.endDate}
                              onChange={e => handleEditFormChange('endDate', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium"
                              required
                            />
                          </div>
                        </div>
                      </div>
                      
                      {/* Section: Technical Settings */}
                      <div className="space-y-4 border border-gray-100 p-5 rounded-xl bg-gray-50/50">
                        <h5 className="font-bold text-xs text-gray-400 uppercase tracking-wider mb-2">Configuración Técnica de Póliza</h5>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Póliza Base (Tarifa) *</label>
                            <select
                              value={editFormData.policyId}
                              onChange={e => handleEditFormChange('policyId', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium"
                            >
                              {policies.map(p => (
                                <option key={p.id} value={p.id}>{p.name} - {p.plan} ({p.region === 2 ? 'R2' : 'R1'})</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">ID Seguro (IDseg)</label>
                            <input
                              type="text"
                              value={editFormData.IDseg}
                              onChange={e => handleEditFormChange('IDseg', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-mono font-bold text-indigo-700"
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
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium"
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
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Section: Commercial Amounts Override */}
                      <div className="space-y-4 border border-orange-100 p-5 rounded-xl bg-orange-50/15">
                        <h5 className="font-bold text-xs text-orange-700 uppercase tracking-wider mb-2">Ajustes de Precios e Importes (USD)</h5>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Precio Base (totalPrice)</label>
                            <input
                              type="number"
                              step="0.01"
                              value={editFormData.totalPrice}
                              onChange={e => handleEditFormChange('totalPrice', parseFloat(e.target.value) || 0)}
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-semibold"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Costo Proveedor (totalCost)</label>
                            <input
                              type="number"
                              step="0.01"
                              value={editFormData.totalCost}
                              onChange={e => handleEditFormChange('totalCost', parseFloat(e.target.value) || 0)}
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-semibold"
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
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-bold text-green-600"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Ajuste Manual</label>
                            <input
                              type="number"
                              step="0.01"
                              value={editFormData.adjustment}
                              onChange={e => handleEditFormChange('adjustment', parseFloat(e.target.value) || 0)}
                              className="w-full px-3 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-semibold"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1 text-[10px]">Comisión Agente</label>
                            <input
                              type="number"
                              step="0.01"
                              value={editFormData.agentCommission}
                              onChange={e => handleEditFormChange('agentCommission', parseFloat(e.target.value) || 0)}
                              className="w-full px-2 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white text-indigo-700 font-bold"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1 text-[10px]">Comisión Tarjeta</label>
                            <input
                              type="number"
                              step="0.01"
                              value={editFormData.comision}
                              onChange={e => handleEditFormChange('comision', parseFloat(e.target.value) || 0)}
                              className="w-full px-2 py-2 border border-gray-250 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-800 font-bold"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1 text-[10px]">Total Final</label>
                            <input
                              type="number"
                              step="0.01"
                              value={editFormData.totalFinal}
                              onChange={e => handleEditFormChange('totalFinal', parseFloat(e.target.value) || 0)}
                              className="w-full px-2 py-2 border border-indigo-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-indigo-50 font-bold text-indigo-950"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Form Controls */}
                    <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                      <button
                        type="button"
                        onClick={() => setIsEditingAll(false)}
                        className="px-5 py-2.5 bg-gray-100 hover:bg-gray-250 text-gray-700 font-bold text-sm rounded-xl cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveAllEdit}
                        disabled={savingEditAll}
                        className="px-6 py-2.5 bg-green-600 hover:bg-green-750 text-white font-bold text-sm rounded-xl shadow-lg shadow-green-100 cursor-pointer disabled:opacity-50"
                      >
                        {savingEditAll ? 'Guardando...' : 'Guardar Cambios'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    {isSuperAdminOrDirector && (
                      <div className="flex justify-end mb-6">
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
                              totalPrice: currentIns.totalPrice || 0,
                              totalCost: currentIns.totalCost || 0,
                              discount: currentIns.discount || 0,
                              adjustment: currentIns.adjustment || 0,
                              agentCommission: currentIns.agentCommission || 0,
                              comision: currentIns.comision || 0,
                              totalFinal: currentIns.totalFinal || 0,
                              actionType: currentIns.actionType || 'NEW'
                            });
                            setIsEditingAll(true);
                          }}
                          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl shadow-lg shadow-indigo-100 transition-all cursor-pointer"
                        >
                          <Pencil className="w-4 h-4" />
                          Editar Seguro Completo
                        </button>
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
                            <div className="flex justify-between">
                              <span className="text-gray-500 text-sm font-medium">Nombre:</span>
                              <span className="font-semibold text-gray-900">{activeInsurance.firstName} {activeInsurance.lastName}</span>
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
                                </div>
                              )}
                            </div>
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
                                isCancellation ? 'bg-red-50 text-red-700 border-red-100' : 'bg-green-50 text-green-700 border-green-100'
                              }`}>
                                {activeInsurance.actionType === 'CAN' ? 'Cancelación' : 
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
                                {activeInsurance.days > 39 && ` (${Math.ceil(activeInsurance.days / 30.4)} meses)`}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500 text-sm font-medium">Estado:</span>
                              <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${
                                activeInsurance.status === 'paid' ? 'bg-green-100 text-green-700 border-green-200' : 
                                activeInsurance.status === 'pending' ? 'bg-yellow-100 text-yellow-700 border-yellow-200' : 
                                activeInsurance.status === 'partially_paid' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                                'bg-red-100 text-red-700 border-red-200'
                              }`}>
                                {activeInsurance.status.toUpperCase()}
                              </span>
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
                            {(activeInsurance.discount || activeInsurance.adjustment) ? (
                              <div className="flex justify-between">
                                <span className="text-gray-500 text-sm font-medium">Precio Base:</span>
                                <span className="font-semibold text-gray-900">${((activeInsurance.totalPrice || 0) * multiplier).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                              </div>
                            ) : null}
                            {activeInsurance.discount ? (
                              <div className="flex justify-between">
                                <span className="text-gray-500 text-sm font-medium">Descuento:</span>
                                <span className="font-bold text-green-600">-${((activeInsurance.discount || 0) * multiplier).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                              </div>
                            ) : null}
                            {activeInsurance.adjustment ? (
                              <div className="flex justify-between">
                                <span className="text-gray-500 text-sm font-medium">Ajuste:</span>
                                <span className={`font-bold ${((activeInsurance.adjustment || 0) * multiplier) > 0 ? 'text-green-600' : 'text-blue-600'}`}>
                                  {((activeInsurance.adjustment || 0) * multiplier) > 0 ? '-' : '+'}${Math.abs((activeInsurance.adjustment || 0) * multiplier).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                                </span>
                              </div>
                            ) : null}
                            <div className="flex justify-between">
                              <span className="text-gray-500 text-sm font-medium">Venta Total:</span>
                              <span className="font-bold text-gray-900">${displayTotalPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500 text-sm font-medium">Costo Proveedor:</span>
                              <span className="font-bold text-red-600">${displayTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500 text-sm font-medium">Comisión Agente:</span>
                              <span className="font-bold text-indigo-600">${displayAgentCommission.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                            </div>
                            <div className="flex justify-between pt-2 border-t border-gray-200">
                              <span className="text-gray-700 font-bold">Total Pagado:</span>
                              <span className="font-bold text-green-600">${displayTotalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-700 font-bold">Saldo Pendiente:</span>
                              <span className="font-bold text-orange-600">
                                ${displayPendingBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
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
                    <p className="text-2xl sm:text-3xl font-extrabold text-emerald-700">${displayTotalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
                  </div>
                  <div className="bg-blue-50 p-5 rounded-2xl border border-blue-100 shadow-sm transition-all hover:shadow-md">
                    <p className="text-xs text-blue-600 font-bold uppercase mb-1 tracking-wider">Venta Total</p>
                    <p className="text-2xl sm:text-3xl font-extrabold text-blue-700">${displayTotalPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
                  </div>
                  <div className={`p-5 rounded-2xl border shadow-sm transition-all hover:shadow-md ${displayPendingBalance >= 3 ? 'bg-amber-50 border-amber-100' : 'bg-gray-50 border-gray-100'}`}>
                    <p className={`text-xs font-bold uppercase mb-1 tracking-wider ${displayPendingBalance >= 3 ? 'text-amber-600' : 'text-gray-500'}`}>Saldo Pendiente</p>
                    <p className={`text-2xl sm:text-3xl font-extrabold ${displayPendingBalance >= 3 ? 'text-amber-700' : 'text-gray-600'}`}>${displayPendingBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
                  </div>
                </div>

                {/* Acciones de Cobro Re-diseñadas para evitar encimamiento o desbordamiento */}
                {((insurance.totalPaid || 0) < insuranceTotalPrice) && !isInsuranceClosed(localInsurance || insurance) && (
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
                              {format(p.date?.toDate ? p.date.toDate() : new Date(p.date), 'dd/MM/yyyy')}
                            </td>
                            <td className="px-6 py-4">
                              <span className={`px-2 py-1 text-[10px] font-bold rounded uppercase border ${
                                p.type === 'client_payment' ? 'bg-green-50 text-green-700 border-green-100' :
                                'bg-red-50 text-red-700 border-red-100'
                              }`}>
                                {p.type === 'client_payment' ? 'Cobro Cliente' : 'Pago Proveedor'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-sm font-bold text-gray-500">
                              {p.receiptNumber || '-'}
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-600">
                              {p.paymentMethod || '-'}
                            </td>
                            <td className="px-6 py-4 text-right">
                              <span className={`text-sm font-bold ${
                                p.type === 'client_payment' ? 'text-green-600' : 'text-red-600'
                              }`}>
                                ${p.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {p.currency}
                              </span>
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
                    <p className="text-3xl font-bold text-indigo-700">${displayAgentCommission.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
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
                                </div>
                              )}
                              <p className="text-[10px] text-gray-400 font-medium">
                                Generada el {format(p.date?.toDate ? p.date.toDate() : new Date(p.date), 'dd/MM/yyyy')}
                              </p>
                            </div>
                          </div>
                          <button 
                            onClick={() => handleConfirmCommission(p.id!)}
                            className="px-4 py-2 bg-orange-600 text-white rounded-xl text-xs font-bold hover:bg-orange-700 transition-all shadow-lg shadow-orange-100 flex items-center gap-2"
                          >
                            Confirmar Comisión
                            <CheckCircle className="w-4 h-4" />
                          </button>
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
                              <p className="text-[10px] text-gray-400 font-medium">
                                Confirmada el {format(p.date?.toDate ? p.date.toDate() : new Date(p.date), 'dd/MM/yyyy')}
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

        <EmailModal
          isOpen={showEmailModal}
          onClose={() => setShowEmailModal(false)}
          insurance={insurance}
          policies={policies}
          policyLetters={policyLetters}
          companySettings={settings}
        />

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
                    <p className="text-xl font-black text-indigo-1000">${displayPendingBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
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
        <div className="p-6 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
          <button 
            onClick={() => setShowEmailModal(true)}
            className="px-6 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
          >
            <Mail className="w-4 h-4" />
            Enviar por Correo
          </button>
          <button 
            onClick={handleDownloadCertificate}
            className="px-6 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2"
          >
            <FileText className="w-4 h-4" />
            Descargar Certificado
          </button>
          <button 
            onClick={onClose}
            className="px-6 py-2 bg-white border border-gray-200 text-gray-700 font-bold rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
