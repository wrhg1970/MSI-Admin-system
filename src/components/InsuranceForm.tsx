import React, { useState, useEffect, useMemo } from 'react';
import { collection, addDoc, serverTimestamp, query, getDocs, orderBy, limit, doc, getDoc, setDoc, onSnapshot, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { UserProfile, Policy, PlanType, ClientType, InsuranceRequest, Country, Client, ExchangeRate, PolicyLetter } from '../types';
import { differenceInYears, differenceInDays, parseISO, format, addDays } from 'date-fns';
import { CheckCircle2, AlertCircle, AlertTriangle, UserPlus, Users, Building2, User, Globe, FileText, Search, Upload, CreditCard, Mail, X, Loader2, Copy } from 'lucide-react';
import BulkImportModal from './BulkImportModal';
import { useNavigate, useLocation } from 'react-router-dom';
import TransactionModal from './TransactionModal';
import EmailModal from './EmailModal';
import { getPolicyNumber, formatDisplayDate } from '../lib/policyUtils';
import { triggerWhatsAppNotification } from '../services/whatsapp';
import { COUNTRIES } from '../constants';
import { isCardPaymentMethod, safeNum, DEFAULT_PAYMENT_METHODS } from '../utils/paymentUtils';
import { useFirestoreData } from '../context/FirestoreDataContext';
import { logInsuranceActivity } from '../utils/activityLogger';

interface InsuranceFormProps {
  profile: UserProfile | null;
}

export default function InsuranceForm({ profile }: InsuranceFormProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const duplicateData = (location.state as any)?.duplicateData;
  const isSuperAdmin = profile?.role === 'super_admin';
  const { 
    policies, 
    countries, 
    clients, 
    insuranceTypes, 
    actionTypes, 
    exchangeRates: allExchangeRates, 
    paymentMethods, 
    policyLetters 
  } = useFirestoreData();

  const [exchangeRate, setExchangeRate] = useState<number>(17.55);
  const [applyIva, setApplyIva] = useState<boolean>(true);
  const [duplicateBanner, setDuplicateBanner] = useState<boolean>(false);
  const [formData, setFormData] = useState({
    clientType: 'Individual' as ClientType,
    clientId: '', // For Agent/Corporate
    linkedAgentId: '', // For specific agent within Agent/Corporate
    firstName: '',
    lastName: '',
    gender: 'M' as 'M' | 'F',
    email: '',
    birthDate: '',
    originCountry: 'MX',
    destinationCountry: 'US',
    city: '',
    policyId: '',
    IDseg: '',
    actionType: 'NEW',
    requestDate: format(new Date(), 'yyyy-MM-dd'),
    startDate: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
    endDate: format(addDays(new Date(), 8), 'yyyy-MM-dd'),
    registerAsNewClient: false,
    isExtremeSports: false,
    notes: '',
    paymentMethod: '',
  });

  // Populate basic data when duplicating from an existing policy
  useEffect(() => {
    if (duplicateData) {
      setFormData(prev => ({
        ...prev,
        clientType: duplicateData.clientType || prev.clientType,
        clientId: duplicateData.clientId !== undefined ? duplicateData.clientId : prev.clientId,
        linkedAgentId: duplicateData.linkedAgentId !== undefined ? duplicateData.linkedAgentId : prev.linkedAgentId,
        firstName: duplicateData.firstName !== undefined ? duplicateData.firstName : prev.firstName,
        lastName: duplicateData.lastName !== undefined ? duplicateData.lastName : prev.lastName,
        birthDate: duplicateData.birthDate !== undefined ? duplicateData.birthDate : prev.birthDate,
        gender: duplicateData.gender || prev.gender,
        email: duplicateData.email !== undefined ? duplicateData.email : prev.email,
        originCountry: duplicateData.originCountry || prev.originCountry,
        destinationCountry: duplicateData.destinationCountry || prev.destinationCountry,
        city: duplicateData.city || prev.city,
      }));
      setDuplicateBanner(true);
    }
  }, [duplicateData]);

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [createdInsuranceId, setCreatedInsuranceId] = useState<string | null>(null);
  const [createdInsurance, setCreatedInsurance] = useState<InsuranceRequest | null>(null);
  const [showPayModal, setShowPayModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  // Duplicate insurance check state
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  const [duplicateMatch, setDuplicateMatch] = useState<InsuranceRequest | null>(null);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);

  const [discount, setDiscount] = useState(0);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [adjustment, setAdjustment] = useState(0);

  const handleDiscountPercentChange = (percent: number) => {
    setDiscountPercent(percent);
    const sBP = safeNum(pricing.basePrice);
    const calculatedDiscount = Math.round((sBP * (percent / 100)) * 100) / 100;
    setDiscount(calculatedDiscount);
  };

  const handleDiscountAmountChange = (amount: number) => {
    setDiscount(amount);
    const sBP = safeNum(pricing.basePrice);
    if (sBP > 0) {
      setDiscountPercent(Math.round((amount / sBP) * 10000) / 100);
    } else {
      setDiscountPercent(0);
    }
  };
  const [error, setError] = useState('');
  const [stripePaymentUrl, setStripePaymentUrl] = useState<string | null>(null);
  const [stripeEmailSent, setStripeEmailSent] = useState<boolean>(false);
  const [stripeLoading, setStripeLoading] = useState<boolean>(false);
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const [isClientSearchOpen, setIsClientSearchOpen] = useState(false);

  // Active payment methods directly from Catálogo Métodos de Pago (Firestore)
  const activePaymentMethods = useMemo(() => {
    const active = paymentMethods.filter(m => !m.status || m.status === 'active');
    if (active.length > 0) {
      return [...active].sort((a, b) => a.name.localeCompare(b.name));
    }
    return DEFAULT_PAYMENT_METHODS.filter(m => m.status === 'active').sort((a, b) => a.name.localeCompare(b.name));
  }, [paymentMethods]);

  // Update exchange rate based on request date from the exchange rate catalog
  useEffect(() => {
    if (!formData.requestDate || allExchangeRates.length === 0) return;

    // Find the exchange rate matching the request date exactly
    const matchedRate = allExchangeRates.find(r => r.date === formData.requestDate);
    if (matchedRate) {
      setExchangeRate(matchedRate.rate);
    } else {
      // If no exact match, find the closest exchange rate on or before the requestDate
      const pastRates = allExchangeRates
        .filter(r => r.date <= formData.requestDate)
        .sort((a, b) => b.date.localeCompare(a.date));

      if (pastRates.length > 0) {
        setExchangeRate(pastRates[0].rate);
      } else {
        // Absolute fallback to earliest rate
        const sortedAsc = [...allExchangeRates].sort((a, b) => a.date.localeCompare(b.date));
        setExchangeRate(sortedAsc[0]?.rate || 17.55);
      }
    }
  }, [formData.requestDate, allExchangeRates]);

  // Set default countries when they are loaded from context
  useEffect(() => {
    if (countries.length > 0) {
      const defaultOrigin = countries.find(c => c.code === 'MX') || countries[0];
      const defaultDest = countries.find(c => c.code === 'US') || countries[0];
      const defaultDestCapital = defaultDest.capital || COUNTRIES.find(c => c.code === defaultDest.code)?.capital || '';
      setFormData(prev => ({
        ...prev,
        originCountry: prev.originCountry || defaultOrigin.code,
        destinationCountry: prev.destinationCountry || defaultDest.code,
        city: prev.city || defaultDestCapital
      }));
    }
  }, [countries]);

  useEffect(() => {
    const fetchIDseg = async () => {
      // Sequential IDseg auto-assignment
      let nextNum = 10001;
      let prefix = 'IDseg';
      let padLength = 5;

      try {
        const counterDocRef = doc(db, 'settings', 'counters');
        const counterDocSnap = await getDoc(counterDocRef);
        
        if (counterDocSnap.exists() && counterDocSnap.data().IDsegCounter !== undefined) {
          nextNum = Number(counterDocSnap.data().IDsegCounter) + 1;
          if (counterDocSnap.data().IDsegPrefix) {
            prefix = counterDocSnap.data().IDsegPrefix;
          }
          if (counterDocSnap.data().IDsegPadLength) {
            padLength = Number(counterDocSnap.data().IDsegPadLength);
          }
        } else {
          // Self-seed from existing insurances
          const insurancesSnap = await getDocs(query(collection(db, 'insurances'), orderBy('createdAt', 'desc'), limit(300)));
          let maxNum = 0;
          insurancesSnap.docs.forEach(d => {
            const data = d.data();
            if (data.IDseg) {
              const match = data.IDseg.match(/^([a-zA-Z_\-]+)?(\d+)$/);
              if (match) {
                const pfx = match[1] || '';
                const numStr = match[2];
                const num = parseInt(numStr, 10);
                if (num > maxNum) {
                  maxNum = num;
                  prefix = pfx || 'IDseg';
                  padLength = numStr.length;
                }
              } else {
                const digitMatch = data.IDseg.match(/\d+/);
                if (digitMatch) {
                  const num = parseInt(digitMatch[0], 10);
                  if (num > maxNum) {
                    maxNum = num;
                  }
                }
              }
            }
          });

          if (maxNum > 0) {
            nextNum = maxNum + 1;
          } else {
            nextNum = 10001; // Default starting number
          }

          // Save the counter to settings/counters for fast subsequent retrievals
          await setDoc(counterDocRef, {
            IDsegCounter: nextNum - 1,
            IDsegPrefix: prefix,
            IDsegPadLength: padLength
          }, { merge: true });
        }

        const nextIDseg = `${prefix}${String(nextNum).padStart(padLength, '0')}`;
        setFormData(prev => ({
          ...prev,
          IDseg: nextIDseg
        }));
      } catch (err) {
        console.error("Error auto-calculating sequential IDseg on mount:", err);
      }
    };

    fetchIDseg();
  }, []);

  const filteredClients = useMemo(() => {
    return clients
      .filter(c => c.type === formData.clientType)
      .sort((a, b) => {
        const nameA = (a.commercialName || a.legalName || `${a.firstName} ${a.lastName}`).trim().toLowerCase();
        const nameB = (b.commercialName || b.legalName || `${b.firstName} ${b.lastName}`).trim().toLowerCase();
        return nameA.localeCompare(nameB, 'es', { sensitivity: 'base' });
      });
  }, [clients, formData.clientType]);

  const searchedClients = useMemo(() => {
    if (formData.clientType !== 'Individual') return [];
    const q = clientSearchQuery.trim().toLowerCase();
    if (!q) return filteredClients;
    return filteredClients.filter(c => {
      const fn = (c.firstName || '').toLowerCase();
      const ln = (c.lastName || '').toLowerCase();
      const fullName = `${fn} ${ln}`;
      const email = (c.email || '').toLowerCase();
      const phone = (c.phone || '').toLowerCase();
      return fn.includes(q) || ln.includes(q) || fullName.includes(q) || email.includes(q) || phone.includes(q);
    });
  }, [filteredClients, clientSearchQuery, formData.clientType]);

  const selectedClient = useMemo(() => {
    return clients.find(c => c.id === formData.clientId);
  }, [clients, formData.clientId]);

  const age = useMemo(() => {
    if (!formData.birthDate) return 0;
    try {
      const refDate = formData.startDate ? parseISO(formData.startDate) : new Date();
      return Math.max(0, differenceInYears(refDate, parseISO(formData.birthDate)));
    } catch {
      return 0;
    }
  }, [formData.birthDate, formData.startDate]);

  const planType = useMemo((): PlanType => {
    if (formData.isExtremeSports && age >= 7 && age <= 69) return 'Xtreme';
    if (age >= 0 && age <= 6) return 'U6';
    if (age >= 7 && age <= 25) return 'Student';
    if (age >= 26 && age <= 69) return 'Traveler';
    if (age >= 70) return 'O70';

    const matchedType = insuranceTypes.find(t => age >= Number(t.minAge) && age <= Number(t.maxAge));
    return matchedType ? matchedType.name as PlanType : (insuranceTypes.length > 0 ? insuranceTypes[insuranceTypes.length - 1].name as PlanType : 'Traveler');
  }, [age, insuranceTypes, formData.isExtremeSports]);

  const destinationRegion = useMemo(() => {
    if (formData.destinationCountry && ['US', 'CA', 'WW'].includes(formData.destinationCountry.toUpperCase())) {
      return 1; // Zona 1
    }
    return 2; // Zona 2 (todos los demás países)
  }, [formData.destinationCountry]);

  const filteredPolicies = useMemo(() => {
    const list = policies.filter(p => {
      if (p.status !== 'active' || p.region !== destinationRegion) return false;

      const planName = (p.plan || '').trim();
      const policyName = (p.name || '').trim().toLowerCase();

      // Check if Platinum policy meets age conditions (default 0-69 years or configured in insuranceTypes)
      const isPlatinum = planName.toLowerCase() === 'platinum' || policyName.includes('platinum') || policyName.includes('platino');
      if (isPlatinum) {
        const platinumType = insuranceTypes.find(t => t.name.toLowerCase() === 'platinum');
        const minA = platinumType ? Number(platinumType.minAge) : 0;
        const maxA = platinumType ? Number(platinumType.maxAge) : 69;
        return age >= minA && age <= maxA;
      }

      // Check if Xtreme policy
      if (planName.toLowerCase() === 'xtreme') {
        return formData.isExtremeSports && age >= 7 && age <= 69;
      }

      // Primary plan match
      return planName === planType;
    });

    const seen = new Set<string>();
    const deduplicatedList: Policy[] = [];
    list.forEach(p => {
      const nameKey = `${(p.name || '').trim().toLowerCase()}-${p.plan}`;
      if (!nameKey) {
        deduplicatedList.push(p);
        return;
      }
      if (!seen.has(nameKey)) {
        seen.add(nameKey);
        deduplicatedList.push(p);
      }
    });
    return deduplicatedList;
  }, [policies, planType, destinationRegion, age, insuranceTypes, formData.isExtremeSports]);

  // Keep policy selection valid when filteredPolicies changes
  useEffect(() => {
    if (filteredPolicies.length > 0) {
      if (!formData.policyId || !filteredPolicies.some(p => p.id === formData.policyId)) {
        setFormData(prev => ({ ...prev, policyId: filteredPolicies[0].id }));
      }
    } else {
      setFormData(prev => ({ ...prev, policyId: '' }));
    }
  }, [filteredPolicies]);

  const days = useMemo(() => {
    if (!formData.startDate || !formData.endDate) return 0;
    const d = differenceInDays(parseISO(formData.endDate), parseISO(formData.startDate)) + 1;
    return d > 0 ? d : 0;
  }, [formData.startDate, formData.endDate]);

  const durationBreakdown = useMemo(() => {
    if (days <= 0) return { billedMonths: 0, billedDays: 0, calculatedMonths: 0, additionalDays: 0 };
    
    if (days < 40) {
      return { billedMonths: 0, billedDays: days, calculatedMonths: 0, additionalDays: days };
    }

    const calculatedMonths = Math.floor(days / 30.4);
    const additionalDays = Math.max(0, days - Math.round(calculatedMonths * 30.4));
    
    let billedMonths = calculatedMonths;
    let billedDays = additionalDays;
    
    if (additionalDays > 15) {
      billedMonths = calculatedMonths + 1;
      billedDays = 0;
    }
    return { billedMonths, billedDays, calculatedMonths, additionalDays };
  }, [days]);

  const months = useMemo(() => {
    return durationBreakdown.billedMonths;
  }, [durationBreakdown]);

  const clientExtraDiscountPercent = useMemo(() => {
    if (!selectedClient) return 0;
    if (formData.clientType !== 'Individual') {
      const la = selectedClient.linkedAgents?.find(a => a.email === formData.linkedAgentId);
      if (la && la.discountPercentage) {
        return la.discountPercentage;
      }
    }
    return selectedClient.discountPercentage || 0;
  }, [selectedClient, formData.clientType, formData.linkedAgentId]);

  const pricing = useMemo(() => {
    const policy = policies.find(p => p.id === formData.policyId);
    if (!policy || days <= 0) {
      return { 
        basePrice: 0, 
        cost: 0, 
        priceMXP: 0, 
        commissionPercent: 0, 
        policyDiscountAmount: 0, 
        clientDiscountPercent: 0, 
        defaultDiscount: 0,
        comision: 0
      };
    }

    const pricePerDay = policy.pricePerDay || 0;
    const pricePerMonth = policy.pricePerMonth || (pricePerDay * 30);
    
    const { billedMonths, billedDays } = durationBreakdown;
    
    let monthlyRate = pricePerMonth;
    if (billedMonths >= 4) {
      monthlyRate = pricePerMonth * 0.8;
    }
    
    let basePrice = (billedMonths * monthlyRate) + (billedDays * pricePerDay);
    basePrice = Math.round(basePrice * 100) / 100;

    let totalCost = policy.costPerDay * days;

    // Default discount calculations: Only Client Discount if applicable (since month discount is already inside basePrice)
    let defaultDiscount = 0;
    let policyDiscountAmount = 0;
    const clientDiscountPercent = clientExtraDiscountPercent;

    if (clientDiscountPercent > 0) {
      const clientDiscountAmount = Math.round((basePrice * (clientDiscountPercent / 100)) * 100) / 100;
      defaultDiscount = clientDiscountAmount;
    }

    // Calculate commission percentage
    let commissionPercent = 0;
    if (formData.clientType !== 'Individual' && selectedClient?.linkedAgents) {
      const la = selectedClient.linkedAgents.find(a => a.email === formData.linkedAgentId);
      if (la) commissionPercent = la.commission;
    } else if (profile?.role === 'agent') {
      commissionPercent = profile.commission || 0;
    }

    const isCard = isCardPaymentMethod(formData.paymentMethod);
    const comision = isCard ? Math.round((safeNum(basePrice) * 0.045) * 100) / 100 : 0;

    return {
      basePrice: Math.round(safeNum(basePrice) * 100) / 100,
      cost: Math.round(safeNum(totalCost) * 100) / 100,
      defaultDiscount,
      commissionPercent,
      priceMXP: Math.round((safeNum(basePrice) - defaultDiscount) * exchangeRate * 100) / 100,
      policyDiscountAmount,
      clientDiscountPercent,
      comision,
    };
  }, [policies, formData.policyId, days, months, durationBreakdown, formData.clientType, selectedClient, formData.linkedAgentId, profile, exchangeRate, clientExtraDiscountPercent, formData.paymentMethod]);

  // Update discount when pricing changes (e.g. policy or client changes)
  useEffect(() => {
    const val = pricing.defaultDiscount || 0;
    setDiscount(val);
    const sBP = safeNum(pricing.basePrice);
    if (sBP > 0) {
      setDiscountPercent(Math.round((val / sBP) * 10000) / 100);
    } else {
      setDiscountPercent(0);
    }
  }, [pricing.defaultDiscount, pricing.basePrice]);

  // Auto-fill traveler data when an existing Individual client is selected
  useEffect(() => {
    if (formData.clientType === 'Individual' && selectedClient) {
      setFormData(prev => ({
        ...prev,
        firstName: selectedClient.firstName || prev.firstName,
        lastName: selectedClient.lastName || prev.lastName,
        gender: (selectedClient as any).gender || prev.gender,
        email: selectedClient.email || prev.email,
        birthDate: (selectedClient as any).birthDate || prev.birthDate,
        city: selectedClient.city || prev.city,
        originCountry: selectedClient.country || prev.originCountry
      }));
    }
  }, [selectedClient, formData.clientType]);

  // Auto-select subagent if only one exists for Agent/Corporate client
  useEffect(() => {
    if (formData.clientType !== 'Individual' && selectedClient && selectedClient.linkedAgents) {
      if (selectedClient.linkedAgents.length === 1) {
        const singleAgentEmail = selectedClient.linkedAgents[0].email;
        if (formData.linkedAgentId !== singleAgentEmail) {
          setFormData(prev => ({
            ...prev,
            linkedAgentId: singleAgentEmail
          }));
        }
      }
    }
  }, [formData.clientType, selectedClient, formData.linkedAgentId]);

  // Auto-fill email field for Agent or Corporate clients, and their subagents
  useEffect(() => {
    if (formData.clientType !== 'Individual') {
      if (formData.linkedAgentId) {
        setFormData(prev => ({
          ...prev,
          email: formData.linkedAgentId
        }));
      } else if (selectedClient) {
        setFormData(prev => ({
          ...prev,
          email: selectedClient.email || prev.email
        }));
      }
    }
  }, [formData.clientType, selectedClient, formData.linkedAgentId]);

  const checkForDuplicateInsurance = async (): Promise<InsuranceRequest | null> => {
    const normalizeString = (str: string): string => {
      return (str || '')
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Remove accents/diacritics
        .replace(/[^a-z0-9 ]/g, "")      // Keep only letters, numbers and spaces
        .replace(/\s+/g, " ");           // Collapse consecutive spaces
    };

    const normFN = normalizeString(formData.firstName);
    const normLN = normalizeString(formData.lastName);
    const normBD = (formData.birthDate || '').trim();
    const normSD = (formData.startDate || '').trim();
    const normED = (formData.endDate || '').trim();

    if (!normFN || !normLN || !normSD || !normED) return null;

    try {
      // Build queries on highly selective single-fields in parallel.
      // 1. Check by birth date
      // 2. Check by start date (backup in case birthDate has any minor differences, or as a combined index-free pool)
      const queries = [];
      if (normBD) {
        queries.push(getDocs(query(collection(db, 'insurances'), where('birthDate', '==', normBD))));
      }
      if (normSD) {
        queries.push(getDocs(query(collection(db, 'insurances'), where('startDate', '==', normSD))));
      }

      // If both normBD and normSD are somehow empty, we fallback to a simple limit-based query
      if (queries.length === 0) {
        queries.push(getDocs(query(collection(db, 'insurances'), limit(300))));
      }

      const snaps = await Promise.all(queries);
      const allDocsMap = new Map<string, any>();
      for (const snap of snaps) {
        snap.docs.forEach(doc => {
          allDocsMap.set(doc.id, { id: doc.id, ...doc.data() });
        });
      }
      const candidates = Array.from(allDocsMap.values()) as InsuranceRequest[];

      const found = candidates.find(ins => {
        const fn = normalizeString(ins.firstName || '');
        const ln = normalizeString(ins.lastName || '');
        const bd = (ins.birthDate || '').trim();
        const sd = (ins.startDate || '').trim();
        const ed = (ins.endDate || '').trim();

        // Full name check combining first and last name to handle different splits
        const normFullName = `${normFN} ${normLN}`.trim().replace(/\s+/g, ' ');
        const insFullName = `${fn} ${ln}`.trim().replace(/\s+/g, ' ');

        const sameName = normFullName === insFullName;
        const sameSD = sd === normSD;
        const sameED = ed === normED;
        const sameBD = normBD ? (bd === normBD) : true;

        return sameName && sameSD && sameED && sameBD;
      });

      return found || null;
    } catch (err) {
      console.error("Error checking duplicate insurance:", err);
      return null;
    }
  };

  const handleOpenConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setCheckingDuplicate(true);

    try {
      const duplicate = await checkForDuplicateInsurance();
      if (duplicate) {
        setDuplicateMatch(duplicate);
        setShowDuplicateModal(true);
        setCheckingDuplicate(false);
        return;
      }
    } catch (err) {
      console.error("Error during duplicate check:", err);
    } finally {
      setCheckingDuplicate(false);
    }

    setShowConfirmModal(true);
  };

  const safeBasePrice = safeNum(pricing.basePrice);
  const safeCost = safeNum(pricing.cost);
  const safeDiscount = safeNum(discount);
  const safeAdjustment = formData.actionType === 'EXT' ? 0 : safeNum(adjustment);
  const safeComision = safeNum(pricing.comision);

  const isMexico = formData.destinationCountry === 'MX' && applyIva;
  const safeIva = isMexico ? safeNum(Math.round(((safeBasePrice - safeDiscount - safeAdjustment) * 0.16) * 100) / 100) : 0;

  const currentCommission = safeNum(Math.round(((safeBasePrice - safeDiscount) * (pricing.commissionPercent / 100)) * 100) / 100);
  const currentTotal = safeNum(Math.round((safeBasePrice - safeDiscount - safeAdjustment + safeIva + safeComision) * 100) / 100);

  const handleConfirmSubmit = async () => {
    setSubmitting(true);
    setError('');

    try {
      // 1. If Individual and registerAsNewClient is checked, create the client first or link existing if email matches
      let finalClientId = formData.clientId;
      if (formData.clientType === 'Individual' && formData.registerAsNewClient) {
        const trimmedEmail = (formData.email || '').trim().toLowerCase();
        if (trimmedEmail) {
          const existingClient = clients.find(c => (c.email || '').trim().toLowerCase() === trimmedEmail);
          if (existingClient) {
            // Use existing client instead of creating duplicate
            finalClientId = existingClient.id;
          } else {
            const newClient: any = {
              type: 'Individual',
              firstName: formData.firstName || '',
              lastName: formData.lastName || '',
              gender: formData.gender,
              email: formData.email || '',
              birthDate: formData.birthDate || '',
              phone: '', 
              address: '',
              city: formData.city || '',
              state: '',
              zip: '',
              country: formData.originCountry || '',
              rfc: '',
              notes: formData.notes || '',
              createdAt: serverTimestamp()
            };
            const clientDoc = await addDoc(collection(db, 'clients'), newClient);
            finalClientId = clientDoc.id;
          }
        } else {
          const newClient: any = {
            type: 'Individual',
            firstName: formData.firstName || '',
            lastName: formData.lastName || '',
            gender: formData.gender,
            email: formData.email || '',
            birthDate: formData.birthDate || '',
            phone: '', 
            address: '',
            city: formData.city || '',
            state: '',
            zip: '',
            country: formData.originCountry || '',
            rfc: '',
            notes: formData.notes || '',
            createdAt: serverTimestamp()
          };
          const clientDoc = await addDoc(collection(db, 'clients'), newClient);
          finalClientId = clientDoc.id;
        }
      }

      const { registerAsNewClient, clientId: _, ...restFormData } = formData;

      const selectedPolicy = policies.find(p => p.id === formData.policyId);

      const insurance: any = {
        age: safeNum(age),
        days: safeNum(days),
        totalPrice: safeBasePrice,
        totalCost: safeCost,
        discount: safeDiscount,
        adjustment: safeAdjustment,
        agentCommission: currentCommission,
        comision: safeComision,
        iva: safeIva,
        totalFinal: currentTotal,
        totalPaid: 0,
        plan: selectedPolicy?.plan || planType,
        policyName: selectedPolicy?.name || '',
        policyNumber: getPolicyNumber(selectedPolicy, age),
        commissionStatus: currentCommission > 0 ? 'confirmed' : 'pending',
        status: 'pending',
        requestDate: formData.requestDate || format(new Date(), 'yyyy-MM-dd'),
        exchangeRate: exchangeRate,
        createdAt: serverTimestamp(),
      };

      // Only add non-undefined fields from restFormData
      Object.entries(restFormData).forEach(([key, value]) => {
        if (value !== undefined) {
          insurance[key] = typeof value === 'string' ? value.trim() : value;
        }
      });

      if (finalClientId) insurance.clientId = finalClientId;
      if (formData.linkedAgentId) insurance.linkedAgentId = formData.linkedAgentId;
      if (profile?.role === 'agent') insurance.agentId = profile.uid;

      console.log('Saving insurance:', insurance);
      const docRef = await addDoc(collection(db, 'insurances'), insurance);
      const newId = docRef.id;

      // Update IDseg counter if needed after successful creation
      try {
        const savedIDseg = insurance.IDseg || '';
        const match = savedIDseg.match(/^([a-zA-Z_\-]+)?(\d+)$/);
        if (match) {
          const pfx = match[1] || 'IDseg';
          const numStr = match[2];
          const num = parseInt(numStr, 10);
          
          const counterDocRef = doc(db, 'settings', 'counters');
          const counterSnap = await getDoc(counterDocRef);
          let currentCounterValue = 0;
          if (counterSnap.exists()) {
            currentCounterValue = Number(counterSnap.data().IDsegCounter) || 0;
          }
          
          if (num > currentCounterValue) {
            await setDoc(counterDocRef, {
              IDsegCounter: num,
              IDsegPrefix: pfx,
              IDsegPadLength: numStr.length
            }, { merge: true });
          }
        }
      } catch (cntErr) {
        console.error("Error updating IDseg counter after creation:", cntErr);
      }

      // Trigger WhatsApp Bienvenida notification asynchronously
      try {
        triggerWhatsAppNotification('bienvenida', { ...insurance, id: newId });
      } catch (waErr) {
        console.error("Error triggering WhatsApp Bienvenido:", waErr);
      }

      // Log activity: Solicitud Creada
      try {
        await logInsuranceActivity({
          insuranceId: newId,
          type: 'automatic',
          description: `Se emitió/creó la póliza del seguro para el asegurado ${insurance.firstName} ${insurance.lastName} por un total de $${(insurance.totalFinal || insurance.totalPrice || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })} USD.`,
          date: new Date(),
          createdBy: profile?.email || 'Sistema'
        });
      } catch (e) {
        console.error("Error logging insurance creation:", e);
      }

      // Check if payment method is card or Stripe
      if (formData.paymentMethod && /stripe|tarjeta|card|crédito|credito/i.test(formData.paymentMethod)) {
        setStripeLoading(true);
        try {
          const amountMXP = Math.round(currentTotal * (exchangeRate || 1) * 100) / 100;
          if (amountMXP > 0) {
            const stripeRes = await fetch('/api/stripe/create-payment-link', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                amount: amountMXP,
                currency: 'MXP',
                description: `Póliza de Seguro - ${insurance.firstName} ${insurance.lastName}`,
                clientEmail: insurance.email || '',
                insuranceId: newId,
                origin: window.location.origin
              })
            });

            if (stripeRes.ok) {
              const stripeData = await stripeRes.json();
              if (stripeData.url) {
                setStripePaymentUrl(stripeData.url);
                
                // Auto-send the email with the Stripe payment link
                if (insurance.email) {
                  try {
                    const emailRes = await fetch('/api/stripe/send-payment-link-email', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        to: insurance.email || '',
                        clientName: `${insurance.firstName} ${insurance.lastName}`,
                        paymentUrl: stripeData.url,
                        amount: amountMXP,
                        currency: 'MXP',
                        description: `Emisión de Póliza de Seguro`
                      })
                    });
                    if (emailRes.ok) {
                      setStripeEmailSent(true);
                    }
                  } catch (e) {
                    console.error("Error sending Stripe email:", e);
                  }
                }
              }
            } else {
              const errData = await stripeRes.json().catch(() => ({}));
              console.warn("Stripe payment link warning:", errData.error || stripeRes.statusText);
            }
          }
        } catch (stripeErr) {
          console.error("Error generating/sending automatic Stripe payment link:", stripeErr);
        } finally {
          setStripeLoading(false);
        }
      }

      setCreatedInsuranceId(newId);
      setCreatedInsurance({ id: newId, ...insurance, createdAt: new Date().toISOString() });
      setSuccess(true);
      setShowConfirmModal(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'insurances');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestAnother = async () => {
    let nextIDseg = formData.IDseg;
    try {
      const counterDocRef = doc(db, 'settings', 'counters');
      const counterSnap = await getDoc(counterDocRef);
      if (counterSnap.exists()) {
        const data = counterSnap.data();
        const num = (Number(data.IDsegCounter) || 10000) + 1;
        const prefix = data.IDsegPrefix || 'IDseg';
        const padLength = Number(data.IDsegPadLength) || 5;
        nextIDseg = `${prefix}${String(num).padStart(padLength, '0')}`;
      } else if (formData.IDseg) {
        const match = formData.IDseg.match(/^([a-zA-Z_\-]+)?(\d+)$/);
        if (match) {
          const pfx = match[1] || 'IDseg';
          const numStr = match[2];
          const num = parseInt(numStr, 10) + 1;
          nextIDseg = `${pfx}${String(num).padStart(numStr.length, '0')}`;
        }
      }
    } catch (err) {
      console.error("Error updating IDseg for next request:", err);
    }

    const isAgentOrCorporate = formData.clientType === 'Agent' || formData.clientType === 'Corporate';

    setSuccess(false);
    setCreatedInsuranceId(null);
    setCreatedInsurance(null);
    setStripePaymentUrl(null);
    setStripeEmailSent(false);

    setFormData(prev => ({
      ...prev,
      IDseg: nextIDseg,
      firstName: '',
      lastName: '',
      birthDate: '',
      notes: '',
      registerAsNewClient: false,
      ...(isAgentOrCorporate ? {
        // Mantener clientId (agente/corporativo), linkedAgentId (subagente), y email
      } : {
        email: '',
        clientId: '',
        linkedAgentId: ''
      })
    }));
  };

  if (success) {
    const isStripe = formData.paymentMethod?.toLowerCase().includes('stripe');
    return (
      <div className="max-w-2xl mx-auto bg-white p-8 rounded-2xl shadow-sm border border-gray-100 text-center">
        <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">¡Solicitud Exitosa!</h2>
        <p className="text-gray-600 mb-6">Se ha generado el seguro y se ha enviado un correo de confirmación a {formData.email}.</p>

        {isStripe && (
          <div className="mb-6 p-5 rounded-2xl border border-indigo-150 bg-indigo-50/40 text-left space-y-3">
            <div className="flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-indigo-600 animate-pulse" />
              <h4 className="font-bold text-indigo-900 text-sm">Pago en línea con Stripe</h4>
            </div>
            <p className="text-xs text-indigo-700 leading-relaxed">
              Se ha generado de manera automática una liga de pago segura de Stripe en pesos mexicanos (MXP). 
              {stripeEmailSent ? ' La liga ya ha sido enviada por correo electrónico al cliente para su pago con tarjeta de crédito/débito.' : ' Generando y enviando liga de pago por correo...'}
            </p>
            {stripePaymentUrl && (
              <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-xl border border-indigo-100 font-mono text-xs text-indigo-700 select-all overflow-hidden relative">
                <span className="truncate flex-1 font-semibold">{stripePaymentUrl}</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(stripePaymentUrl);
                    alert("¡Liga de pago copiada al portapapeles!");
                  }}
                  className="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 rounded text-xs font-bold text-indigo-600 transition-colors shrink-0"
                >
                  Copiar Liga
                </button>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
          <button
            onClick={handleRequestAnother}
            className="bg-gray-100 text-gray-700 px-6 py-2.5 rounded-xl font-bold hover:bg-gray-200 transition-all text-sm w-full sm:w-auto"
          >
            Solicitar otro seguro
          </button>

          {createdInsuranceId && !isStripe && (
            <button
              onClick={() => setShowPayModal(true)}
              className="bg-green-600 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-green-700 transition-all shadow-lg shadow-green-100 flex items-center justify-center gap-2 text-sm w-full sm:w-auto"
            >
              <CreditCard className="w-4 h-4" />
              Ingresar Pago Directo
            </button>
          )}

          {isStripe && stripePaymentUrl && (
            <a
              href={stripePaymentUrl}
              target="_blank"
              rel="noreferrer"
              className="bg-indigo-600 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 flex items-center justify-center gap-2 text-sm w-full sm:w-auto"
            >
              <CreditCard className="w-4 h-4" />
              Pagar con Stripe
            </a>
          )}

          {createdInsuranceId && (
            <button
              type="button"
              onClick={() => setShowEmailModal(true)}
              className="bg-purple-600 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-purple-700 transition-all shadow-lg shadow-purple-100 flex items-center justify-center gap-2 text-sm w-full sm:w-auto"
            >
              <Mail className="w-4 h-4" />
              Enviar por Correo
            </button>
          )}

          <button
            onClick={() => navigate('/policies')}
            className="bg-blue-600 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 flex items-center justify-center gap-2 text-sm w-full sm:w-auto"
          >
            <FileText className="w-4 h-4" />
            Ver Pólizas
          </button>
        </div>

        {createdInsuranceId && !isStripe && (
          <TransactionModal
            isOpen={showPayModal}
            onClose={() => setShowPayModal(false)}
            insuranceId={createdInsuranceId}
            title="Registrar Pago de la Nueva Póliza"
            initialShowAddForm={true}
          />
        )}

        {createdInsuranceId && (
          <EmailModal
            isOpen={showEmailModal}
            onClose={() => setShowEmailModal(false)}
            insurance={createdInsurance}
            policies={policies}
            policyLetters={policyLetters}
          />
        )}
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-8 flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Solicitar Nuevo Seguro</h1>
          <p className="text-gray-500">Complete los datos del viajero para emitir la póliza</p>
        </div>
        <button
          onClick={() => setShowImportModal(true)}
          className="flex items-center gap-2 px-6 py-3 bg-indigo-50 text-indigo-600 rounded-xl font-bold border border-indigo-100 hover:bg-indigo-100 transition-all shadow-sm"
        >
          <Upload className="w-5 h-5" />
          Importación Masiva
        </button>
      </header>

      <BulkImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        policies={policies}
        countries={countries}
        clients={clients}
        insuranceTypes={insuranceTypes}
        exchangeRate={exchangeRate}
        profile={profile}
      />

      {duplicateBanner && (
        <div className="mb-6 p-4 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center justify-between gap-3 text-sm text-indigo-900 shadow-sm animate-in fade-in">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 rounded-lg text-indigo-700">
              <Copy className="w-5 h-5 flex-shrink-0" />
            </div>
            <div>
              <p className="font-bold text-indigo-900">Póliza duplicada con datos básicos</p>
              <p className="text-xs text-indigo-700">
                Se han cargado los datos de: <strong>{formData.firstName} {formData.lastName}</strong> ({formData.clientType}{formData.birthDate ? ` • Nacimiento: ${formData.birthDate}` : ''}). Seleccione las fechas de viaje y plan para emitir el nuevo seguro.
              </p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={() => setDuplicateBanner(false)}
            className="text-indigo-400 hover:text-indigo-700 p-1.5 rounded-lg hover:bg-indigo-100 transition-colors"
            title="Cerrar aviso"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <form onSubmit={handleOpenConfirm} className="space-y-8">
        {/* Client Info */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-3">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-600" />
              <h3 className="text-lg font-semibold">Información del Cliente</h3>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-gray-500 uppercase shrink-0">Fecha de Solicitud:</label>
              <input
                type="date"
                required
                value={formData.requestDate}
                onChange={e => setFormData({ ...formData, requestDate: e.target.value })}
                disabled={!isSuperAdmin}
                className="p-1.5 px-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-xs font-bold text-gray-700 bg-gray-50 focus:bg-white disabled:opacity-75 disabled:cursor-not-allowed"
              />
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tipo de Cliente</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['Individual', 'Agent', 'Corporate'] as ClientType[]).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setFormData({ ...formData, clientType: type, clientId: '' })}
                      className={`p-3 border rounded-xl flex flex-col items-center gap-1 transition-all ${
                        formData.clientType === type 
                          ? 'border-blue-600 bg-blue-50 text-blue-600 ring-1 ring-blue-600' 
                          : 'border-gray-100 hover:border-gray-200 text-gray-400'
                      }`}
                    >
                      {type === 'Agent' ? <Users className="w-5 h-5" /> :
                       type === 'Corporate' ? <Building2 className="w-5 h-5" /> :
                       <User className="w-5 h-5" />}
                      <span className="text-[10px] font-bold">{type === 'Agent' ? 'Agente' : type === 'Corporate' ? 'Corporativo' : 'Individual'}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tipo de Acción</label>
                  <select
                    required
                    value={formData.actionType}
                    onChange={e => {
                      const newType = e.target.value;
                      setFormData({ ...formData, actionType: newType });
                      if (newType === 'EXT') setAdjustment(0);
                    }}
                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm font-semibold"
                  >
                    {actionTypes.length > 0 ? (
                      actionTypes.map(at => (
                        <option key={at.action} value={at.action}>{at.action} - {at.name}</option>
                      ))
                    ) : (
                      <>
                        <option value="NEW">NEW - Nuevo</option>
                        <option value="COR">COR - Corrección</option>
                        <option value="CAN">CAN - Cancelación</option>
                      </>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">IDseg</label>
                  <input
                    type="text"
                    disabled
                    readOnly
                    value={formData.IDseg || ''}
                    className="w-full p-2.5 border border-gray-200 bg-gray-50 rounded-lg outline-none cursor-not-allowed font-mono text-gray-500 font-bold text-sm"
                    placeholder="Auto-asignado"
                  />
                </div>
              </div>
            </div>

            {formData.clientType !== 'Individual' ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                    {formData.clientType === 'Agent' ? 'Agente/Agencia' : 'Empresa Corporativa'}
                  </label>
                  <select
                    required
                    value={formData.clientId}
                    onChange={e => setFormData({ ...formData, clientId: e.target.value, linkedAgentId: '' })}
                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    <option value="">Seleccione {formData.clientType === 'Agent' ? 'el agente' : 'la empresa'}...</option>
                    {filteredClients.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.commercialName || c.legalName} ({c.email})
                      </option>
                    ))}
                  </select>
                  {filteredClients.length === 0 && (
                    <p className="mt-1 text-xs text-red-500">No hay {formData.clientType === 'Agent' ? 'agentes' : 'corporativos'} registrados.</p>
                  )}
                </div>

                {selectedClient && selectedClient.linkedAgents && selectedClient.linkedAgents.length > 0 && (
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Agente que lo solicita</label>
                    <select
                      required
                      value={formData.linkedAgentId}
                      onChange={e => setFormData({ ...formData, linkedAgentId: e.target.value })}
                      className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      <option value="">Seleccione el agente específico...</option>
                      {[...(selectedClient.linkedAgents || [])]
                        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'es', { sensitivity: 'base' }))
                        .map((la, index) => (
                          <option key={index} value={la.email}>
                            {la.name} ({la.email})
                          </option>
                        ))}
                    </select>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                    Buscar Cliente Existente (Nombre o Apellido)
                  </label>
                  {formData.clientId && selectedClient ? (
                    <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-xl">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs shadow-sm">
                          {selectedClient.firstName?.[0] || ''}{selectedClient.lastName?.[0] || 'C'}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-gray-900">
                            {selectedClient.firstName} {selectedClient.lastName}
                          </p>
                          <p className="text-xs text-gray-500">{selectedClient.email || 'Sin correo registrado'}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setFormData({
                            ...formData,
                            clientId: '',
                            firstName: '',
                            lastName: '',
                            email: '',
                            city: '',
                            registerAsNewClient: false
                          });
                          setClientSearchQuery('');
                        }}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-800 bg-white px-3 py-1.5 border border-blue-200 rounded-lg shadow-sm transition-all"
                      >
                        Cambiar / Limpiar
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <div className="relative">
                        <input
                          type="text"
                          value={clientSearchQuery}
                          onChange={(e) => {
                            setClientSearchQuery(e.target.value);
                            setIsClientSearchOpen(true);
                          }}
                          onFocus={() => setIsClientSearchOpen(true)}
                          placeholder="Buscar por nombre, apellido o email..."
                          className="w-full p-2.5 pl-10 pr-8 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                        />
                        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        {clientSearchQuery && (
                          <button
                            type="button"
                            onClick={() => setClientSearchQuery('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      {isClientSearchOpen && (
                        <>
                          <div 
                            className="fixed inset-0 z-10" 
                            onClick={() => setIsClientSearchOpen(false)} 
                          />
                          <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-64 overflow-y-auto divide-y divide-gray-100">
                            <button
                              type="button"
                              onClick={() => {
                                setFormData({
                                  ...formData,
                                  clientId: '',
                                  registerAsNewClient: true
                                });
                                setClientSearchQuery('');
                                setIsClientSearchOpen(false);
                              }}
                              className="w-full text-left p-3 hover:bg-gray-50 flex items-center gap-2 transition-colors group"
                            >
                              <UserPlus className="w-4 h-4 text-blue-600" />
                              <span className="text-xs font-bold text-blue-600">Nuevo Cliente (Ingresar datos manualmente abajo)</span>
                            </button>

                            {searchedClients.length > 0 ? (
                              searchedClients.map(c => (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() => {
                                    setFormData({
                                      ...formData,
                                      clientId: c.id || '',
                                      firstName: c.firstName || '',
                                      lastName: c.lastName || '',
                                      email: c.email || '',
                                      city: c.city || '',
                                      registerAsNewClient: false
                                    });
                                    setClientSearchQuery('');
                                    setIsClientSearchOpen(false);
                                  }}
                                  className="w-full text-left p-3 hover:bg-blue-50 flex items-center justify-between transition-colors group"
                                >
                                  <div>
                                    <p className="text-sm font-bold text-gray-900 group-hover:text-blue-700">
                                      {c.firstName} {c.lastName}
                                    </p>
                                    <p className="text-xs text-gray-500">{c.email || 'Sin correo registrado'}</p>
                                  </div>
                                  <span className="text-xs font-bold text-blue-600 bg-blue-50 group-hover:bg-blue-100 px-2 py-1 rounded">
                                    Seleccionar
                                  </span>
                                </button>
                              ))
                            ) : (
                              <div className="p-4 text-center text-xs text-gray-500">
                                No se encontraron clientes que coincidan con "<span className="font-semibold text-gray-700">{clientSearchQuery}</span>"
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {!formData.clientId && (
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${formData.registerAsNewClient ? 'bg-blue-600 border-blue-600' : 'border-gray-300 group-hover:border-blue-400'}`}>
                        {formData.registerAsNewClient && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                      </div>
                      <input
                        type="checkbox"
                        className="hidden"
                        checked={formData.registerAsNewClient}
                        onChange={e => setFormData({ ...formData, registerAsNewClient: e.target.checked })}
                      />
                      <span className="text-sm font-medium text-gray-700">Registrar como nuevo cliente</span>
                    </label>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nombre</label>
              <input
                type="text"
                required
                value={formData.firstName}
                onChange={e => setFormData({ ...formData, firstName: e.target.value })}
                className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Apellido</label>
              <input
                type="text"
                required
                value={formData.lastName}
                onChange={e => setFormData({ ...formData, lastName: e.target.value })}
                className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Sexo</label>
              <div className="flex gap-4 p-2">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${formData.gender === 'M' ? 'border-blue-600 bg-blue-600' : 'border-gray-300 group-hover:border-blue-400'}`}>
                    {formData.gender === 'M' && <div className="w-2 h-2 bg-white rounded-full" />}
                  </div>
                  <input
                    type="radio"
                    className="hidden"
                    name="gender"
                    value="M"
                    checked={formData.gender === 'M'}
                    onChange={() => setFormData({ ...formData, gender: 'M' })}
                  />
                  <span className="text-sm font-medium text-gray-700 uppercase">M</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer group">
                  <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${formData.gender === 'F' ? 'border-blue-600 bg-blue-600' : 'border-gray-300 group-hover:border-blue-400'}`}>
                    {formData.gender === 'F' && <div className="w-2 h-2 bg-white rounded-full" />}
                  </div>
                  <input
                    type="radio"
                    className="hidden"
                    name="gender"
                    value="F"
                    checked={formData.gender === 'F'}
                    onChange={() => setFormData({ ...formData, gender: 'F' })}
                  />
                  <span className="text-sm font-medium text-gray-700 uppercase">F</span>
                </label>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Correo Electrónico</label>
              <input
                type="email"
                required
                value={formData.email}
                onChange={e => setFormData({ ...formData, email: e.target.value })}
                className={`w-full p-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none ${
                  formData.registerAsNewClient && formData.email && clients.some(c => (c.email || '').trim().toLowerCase() === formData.email.trim().toLowerCase())
                    ? 'border-amber-400 bg-amber-50/50'
                    : 'border-gray-300'
                }`}
                placeholder="ejemplo@correo.com"
              />
              {formData.registerAsNewClient && formData.email && clients.some(c => (c.email || '').trim().toLowerCase() === formData.email.trim().toLowerCase()) && (
                <p className="text-xs text-amber-700 font-medium mt-1">
                  ℹ️ Este correo pertenece a un cliente existente. Se asociará la póliza automáticamente a su expediente.
                </p>
              )}
            </div>

            {formData.registerAsNewClient && (
              <div className="md:col-span-2 mt-2 animate-in fade-in slide-in-from-top-2">
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Notas del Cliente</label>
                <textarea
                  value={formData.notes}
                  onChange={e => setFormData({ ...formData, notes: e.target.value })}
                  rows={2}
                  className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                  placeholder="Notas adicionales sobre el nuevo cliente..."
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Fecha de Nacimiento</label>
              <input
                type="date"
                required
                value={formData.birthDate}
                onChange={e => {
                  const newBirthDate = e.target.value;
                  const refDate = formData.startDate ? parseISO(formData.startDate) : new Date();
                  const newAge = differenceInYears(refDate, parseISO(newBirthDate));
                  setFormData(prev => ({ 
                    ...prev, 
                    birthDate: newBirthDate,
                    isExtremeSports: (newAge >= 7 && newAge <= 69) ? prev.isExtremeSports : false
                  }));
                }}
                className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
              {formData.birthDate && (
                <p className="mt-1 text-xs text-blue-600 font-bold">Edad al inicio del seguro: {age} {age === 1 ? 'año' : 'años'} ({planType})</p>
              )}
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Notas de la Solicitud</label>
              <textarea
                value={formData.notes}
                onChange={e => setFormData({ ...formData, notes: e.target.value })}
                rows={2}
                className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                placeholder="Notas o comentarios adicionales..."
              />
            </div>

            {age >= 7 && age <= 69 && (
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">¿Solicitar Deportes Extremos?</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="extremeSports"
                      checked={formData.isExtremeSports === true}
                      onChange={() => setFormData({ ...formData, isExtremeSports: true })}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="text-sm font-medium text-gray-700">Sí, incluir deportes extremos</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="extremeSports"
                      checked={formData.isExtremeSports === false}
                      onChange={() => setFormData({ ...formData, isExtremeSports: false })}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="text-sm font-medium text-gray-700">No, cobertura estándar</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Trip Info */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-6">
          <div className="flex items-center gap-2 border-b pb-2">
            <Globe className="w-5 h-5 text-blue-600" />
            <h3 className="text-lg font-semibold">Información del Viaje</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">País de Origen</label>
              <select
                value={formData.originCountry}
                onChange={e => setFormData({ ...formData, originCountry: e.target.value })}
                className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              >
                {Array.from(new Map([...COUNTRIES, ...countries].map(c => [c.code, c])).values())
                  .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' }))
                  .map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">País de Destino</label>
              <select
                value={formData.destinationCountry}
                onChange={e => {
                  const targetCode = e.target.value;
                  const foundCountry = countries.find(c => c.code === targetCode) || COUNTRIES.find(c => c.code === targetCode);
                  const capital = foundCountry?.capital || '';
                  setFormData({
                    ...formData,
                    destinationCountry: targetCode,
                    city: capital
                  });
                }}
                className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              >
                {Array.from(new Map([...COUNTRIES, ...countries].map(c => [c.code, c])).values())
                  .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' }))
                  .map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
              <p className="mt-1 text-xs text-blue-600 font-bold">Región: {destinationRegion}</p>
              {formData.destinationCountry === 'MX' && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="applyIva"
                    checked={applyIva}
                    onChange={e => setApplyIva(e.target.checked)}
                    className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                  />
                  <label htmlFor="applyIva" className="text-xs font-bold text-gray-700 select-none cursor-pointer">
                    Cargar IVA (16%)
                  </label>
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Ciudad</label>
              <input
                type="text"
                required
                value={formData.city}
                onChange={e => setFormData({ ...formData, city: e.target.value })}
                className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Fecha Salida</label>
                <input
                  type="date"
                  required
                  value={formData.startDate}
                  onChange={e => setFormData({ ...formData, startDate: e.target.value })}
                  className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Fecha Regreso</label>
                <input
                  type="date"
                  required
                  value={formData.endDate}
                  onChange={e => setFormData({ ...formData, endDate: e.target.value })}
                  className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>
          </div>
          {days > 0 && (
            <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-blue-600 text-white p-2 rounded-lg">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-blue-900">Duración del Viaje</p>
                  <p className="text-xs text-blue-700">
                    {days} días {durationBreakdown.billedMonths > 0 && `(${durationBreakdown.billedMonths} ${durationBreakdown.billedMonths === 1 ? 'mes' : 'meses'}${durationBreakdown.billedDays > 0 ? ` + ${durationBreakdown.billedDays} ${durationBreakdown.billedDays === 1 ? 'día' : 'días'}` : ''})`}
                  </p>
                </div>
              </div>
              {months > 0 && (
                <span className="bg-blue-200 text-blue-800 text-[10px] font-bold px-2 py-1 rounded-full uppercase">Tarifa Mensual</span>
              )}
            </div>
          )}
        </div>

        {/* Payment Method Selection */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-4">
          <div className="flex items-center gap-2 border-b pb-2">
            <CreditCard className="w-5 h-5 text-blue-600" />
            <h3 className="text-lg font-semibold">Forma de Pago</h3>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Seleccione el Método de Pago</label>
            <select
              value={formData.paymentMethod || ''}
              onChange={e => setFormData({ ...formData, paymentMethod: e.target.value })}
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-medium text-gray-800"
            >
              <option value="">Seleccione método...</option>
              {activePaymentMethods.map(m => (
                <option key={m.id} value={m.name}>{m.name}</option>
              ))}
            </select>
            <p className="text-[11px] text-gray-400 mt-1">
              Nota: Al seleccionar Tarjeta de Crédito, Débito o AMEX, se aplicará automáticamente la comisión correspondiente por procesamiento con tarjeta.
            </p>
          </div>
        </div>

        {/* Policy Selection */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-6">
          <div className="flex items-center gap-2 border-b pb-2">
            <FileText className="w-5 h-5 text-blue-600" />
            <h3 className="text-lg font-semibold">Selección de Póliza</h3>
          </div>
          <div className="grid grid-cols-1 gap-4">
            {filteredPolicies.length > 0 ? (
              filteredPolicies.map(p => (
                <label
                  key={p.id}
                  className={`flex items-center justify-between p-4 border rounded-xl cursor-pointer transition-all ${
                    formData.policyId === p.id ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <input
                      type="radio"
                      name="policy"
                      checked={formData.policyId === p.id}
                      onChange={() => setFormData({ ...formData, policyId: p.id })}
                      className="w-4 h-4 text-blue-600"
                    />
                    <div>
                      <p className="font-bold text-gray-900">{p.name}</p>
                      <p className="text-xs text-gray-500">{p.deductible ? 'Con deducible' : 'Sin deducible'} • Plan {p.plan}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    {months === 0 ? (
                      /* Si el tiempo de viaje son dias que solo salga el precio de dia */
                      <p className="text-lg font-bold text-blue-600">${p.pricePerDay}/día</p>
                    ) : (
                      /* Si el tiempo de viaje tiene meses de facturación */
                      <>
                        <p className="text-lg font-bold text-indigo-600">${p.pricePerMonth || Math.round(p.pricePerDay * 30)}/mes</p>
                        {durationBreakdown.billedDays > 0 && (
                          <p className="text-xs font-semibold text-gray-500">
                            + ${p.pricePerDay}/día adicional ({durationBreakdown.billedDays} {durationBreakdown.billedDays === 1 ? 'día' : 'días'})
                          </p>
                        )}
                        {months >= 4 && (
                          <>
                            {p.discountPercentage && p.discountPercentage > 0 && (
                              <p className="text-xs text-green-600 font-bold">-{p.discountPercentage}% Desc.</p>
                            )}
                            {clientExtraDiscountPercent > 0 && (
                              <p className="text-xs text-purple-600 font-black tracking-wide">
                                -{clientExtraDiscountPercent}% Descuento Extra
                              </p>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>
                </label>
              ))
            ) : (
              <p className="text-gray-500 text-center py-4 italic">No hay pólizas disponibles para esta edad y región.</p>
            )}
          </div>
        </div>

        {/* Summary & Submit */}
        <div className="bg-blue-600 p-8 rounded-2xl shadow-lg text-white flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="flex-1">
            <p className="text-blue-100 text-xs uppercase tracking-wider font-bold mb-2">Resumen de Cotización</p>
            <div className="space-y-4">
              <div>
                <div className="flex items-baseline gap-2">
                  <h2 className="text-4xl font-bold">${safeNum(currentTotal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h2>
                  <span className="text-xl font-medium text-blue-200">USD</span>
                </div>
                <div className="flex items-baseline gap-2 mt-1 opacity-90">
                  <h3 className="text-2xl font-bold">${safeNum(currentTotal * (exchangeRate || 1)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
                  <span className="text-lg font-medium text-blue-200">MXP</span>
                  <span className="text-[10px] bg-blue-500/30 px-2 py-0.5 rounded border border-blue-400/30">TC: {(exchangeRate || 1).toFixed(2)}</span>
                </div>
              </div>

              {(isCardPaymentMethod(formData.paymentMethod) || safeNum(pricing.comision) > 0) && (
                <div className="bg-blue-700/80 p-3.5 rounded-xl border border-blue-400/30 space-y-1.5 text-xs max-w-md">
                  <div className="flex justify-between text-blue-100">
                    <span>Precio Venta Seguro:</span>
                    <span className="font-bold text-white">${safeNum(pricing.basePrice - discount - adjustment).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                  </div>
                  <div className="flex justify-between text-amber-200">
                    <span className="font-semibold">Comisión por Tarjeta (4.5%):</span>
                    <span className="font-bold text-amber-300">+${safeNum(pricing.comision).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                  </div>
                  <div className="flex justify-between text-white font-bold pt-1 border-t border-blue-500/40">
                    <span>Total con Tarjeta:</span>
                    <span>${safeNum(currentTotal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                  </div>
                </div>
              )}
              
              <div className="flex flex-wrap gap-2">
                {isCardPaymentMethod(formData.paymentMethod) && (
                  <span className="text-[10px] bg-amber-500 text-white px-2 py-1 rounded-full font-bold uppercase tracking-wider">
                    Comisión Tarjeta (4.5%)
                  </span>
                )}
                {discount > 0 && (
                  <span className="text-[10px] bg-green-500 px-2 py-1 rounded-full font-bold uppercase tracking-wider">
                    Descuento Aplicado
                  </span>
                )}
                {pricing.clientDiscountPercent > 0 && (
                  <span className="text-[10px] bg-purple-500 text-white px-2 py-1 rounded-full font-bold uppercase tracking-wider">
                    Descuento Extra
                  </span>
                )}
                <span className="text-[10px] bg-blue-500 px-2 py-1 rounded-full font-bold uppercase tracking-wider">
                  {days} días de cobertura
                </span>
                {months > 0 && (
                  <span className="text-[10px] bg-indigo-500 px-2 py-1 rounded-full font-bold uppercase tracking-wider">
                    Tarifa Mensual ({months}m)
                  </span>
                )}
              </div>
            </div>
          </div>
          
          <div className="w-full md:w-auto min-w-[250px]">
            {error && (
              <div className="mb-4 flex items-center gap-2 text-red-200 text-sm bg-red-900/20 p-3 rounded-lg">
                <AlertCircle className="w-5 h-5" />
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={submitting || checkingDuplicate || !formData.policyId || days <= 0 || (formData.clientType !== 'Individual' && !formData.clientId)}
              className="w-full bg-white text-blue-600 font-bold py-4 px-8 rounded-xl hover:bg-blue-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-xl active:scale-95 flex items-center justify-center gap-2"
            >
              {checkingDuplicate ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                  <span>Verificando duplicados...</span>
                </>
              ) : submitting ? (
                <span>Procesando...</span>
              ) : (
                <span>Emitir Póliza</span>
              )}
            </button>
            <p className="text-[10px] text-blue-200 text-center mt-3">
              Al emitir, se generará la póliza y se notificará al cliente.
            </p>
          </div>
        </div>
      </form>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-blue-600 p-6 text-white">
              <h3 className="text-xl font-bold">Confirmar Emisión de Póliza</h3>
              <p className="text-blue-100 text-sm">Revise los detalles antes de generar el registro</p>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-8">
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Datos del Viajero</h4>
                  <div className="space-y-2">
                    <p className="text-sm">
                      <span className="text-gray-500">Tipo:</span>{' '}
                      <span className="font-bold text-gray-900">
                        {formData.clientType === 'Individual' ? 'Individual' : 
                          `${formData.clientType === 'Agent' ? 'Agente' : 'Corporativo'}: ${selectedClient?.commercialName || selectedClient?.legalName || ''}`}
                        {formData.linkedAgentId && ` (${selectedClient?.linkedAgents?.find(a => a.email === formData.linkedAgentId)?.name})`}
                      </span>
                    </p>
                    <p className="text-sm"><span className="text-gray-500">Nombre:</span> <span className="font-bold text-gray-900">{formData.firstName} {formData.lastName}</span></p>
                    <p className="text-sm"><span className="text-gray-500">Edad:</span> <span className="font-bold text-gray-900">{age} años ({planType})</span></p>
                    <p className="text-sm"><span className="text-gray-500">Solicitud:</span> <span className="font-bold text-gray-900">{formatDisplayDate(formData.requestDate)}</span></p>
                    <p className="text-sm"><span className="text-gray-500">Acción:</span> <span className="font-bold text-blue-600">{formData.actionType}</span></p>
                    <p className="text-sm"><span className="text-gray-500">Vigencia:</span> <span className="font-bold text-gray-900">{formatDisplayDate(formData.startDate)} al {formatDisplayDate(formData.endDate)}</span></p>
                    <p className="text-sm"><span className="text-gray-500">Cobertura:</span> <span className="font-bold text-blue-600">{days} días {durationBreakdown.billedMonths > 0 && `(${durationBreakdown.billedMonths} ${durationBreakdown.billedMonths === 1 ? 'mes' : 'meses'}${durationBreakdown.billedDays > 0 ? ` + ${durationBreakdown.billedDays} ${durationBreakdown.billedDays === 1 ? 'día' : 'días'}` : ''})`}</span></p>
                    <p className="text-sm">
                      <span className="text-gray-500">Origen/Destino:</span>{' '}
                      <span className="font-bold text-gray-900">
                        {countries.find(c => c.code === formData.originCountry)?.name} → {countries.find(c => c.code === formData.destinationCountry)?.name}
                      </span>
                    </p>
                    <p className="text-sm">
                      <span className="text-gray-500">Póliza:</span>{' '}
                      <span className="font-bold text-indigo-600">
                        {policies.find(p => p.id === formData.policyId)?.name}
                      </span>
                    </p>
                    <p className="text-sm">
                      <span className="text-gray-500">Método de Pago:</span>{' '}
                      <span className="font-bold text-slate-700 capitalize">
                        {formData.paymentMethod || 'No especificado'}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Desglose Económico</h4>
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Precio Base:</span>
                      <span className="font-bold text-gray-900">${safeNum(pricing.basePrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                    </div>

                    <div className="flex justify-between text-sm items-center">
                      <span className="text-gray-500">Descuento:</span>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            max="100"
                            placeholder="%"
                            value={discountPercent || ''}
                            onChange={e => handleDiscountPercentChange(parseFloat(e.target.value) || 0)}
                            className="w-14 p-1 border border-gray-300 rounded text-center font-bold text-green-600 focus:ring-1 focus:ring-green-500 outline-none text-xs"
                          />
                          <span className="text-xs text-gray-400 font-bold">%</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-gray-400">$</span>
                          <input
                            type="number"
                            step="0.01"
                            value={discount}
                            onChange={e => handleDiscountAmountChange(parseFloat(e.target.value) || 0)}
                            className="w-20 p-1 border border-gray-300 rounded text-right font-bold text-green-600 focus:ring-1 focus:ring-green-500 outline-none"
                          />
                        </div>
                      </div>
                    </div>
                    
                    {safeNum(pricing.clientDiscountPercent) > 0 && (
                      <div className="bg-purple-50 p-2.5 rounded-lg border border-purple-100 space-y-1 text-[11px]">
                        <div className="font-semibold text-purple-700 flex justify-between">
                          <span>Descuento de Póliza:</span>
                          <span>-${safeNum(pricing.policyDiscountAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })} USD</span>
                        </div>
                        <div className="font-black text-purple-800 flex justify-between">
                          <span>Descuento Extra ({pricing.clientDiscountPercent}%):</span>
                          <span>-${safeNum(Math.round((safeNum(pricing.basePrice) - safeNum(pricing.policyDiscountAmount)) * (safeNum(pricing.clientDiscountPercent) / 100) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })} USD</span>
                        </div>
                      </div>
                    )}
                    
                    <div className="flex justify-between text-sm items-center">
                      <span className="text-gray-500">Ajuste:</span>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400">$</span>
                        <input
                          type="number"
                          step="0.01"
                          value={adjustment}
                          onChange={e => setAdjustment(parseFloat(e.target.value) || 0)}
                          className="w-20 p-1 border border-gray-300 rounded text-right font-bold text-blue-600 focus:ring-1 focus:ring-blue-500 outline-none"
                        />
                      </div>
                    </div>

                    {safeNum(pricing.comision) > 0 && (
                      <div className="flex justify-between text-sm items-center text-amber-600">
                        <span className="font-bold">Comisión de Pago (4.5%):</span>
                        <span className="font-bold">+${safeNum(pricing.comision).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                      </div>
                    )}

                    {safeIva > 0 && (
                      <div className="flex justify-between text-sm items-center text-rose-600">
                        <span className="font-bold">IVA (16%):</span>
                        <span className="font-bold">+${safeIva.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                      </div>
                    )}

                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Comisión Agente ({safeNum(pricing.commissionPercent)}%):</span>
                      <span className="font-bold text-indigo-600">${safeNum(currentCommission).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                    </div>

                    <div className="pt-3 border-t border-gray-100">
                      <div className="flex justify-between items-baseline">
                        <span className="text-gray-900 font-bold">Total Final:</span>
                        <div className="text-right">
                          <p className="text-2xl font-black text-blue-600">${safeNum(currentTotal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
                          <p className="text-sm font-bold text-gray-500">${safeNum(currentTotal * (exchangeRate || 1)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXP</p>
                          <p className="text-[10px] font-black text-blue-500 mt-1 uppercase tracking-wider">T.C. Utilizado: ${(exchangeRate || 1).toFixed(4)} MXN</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-yellow-50 p-4 rounded-xl border border-yellow-100 flex gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-600 shrink-0" />
                <p className="text-xs text-yellow-800">
                  Al confirmar, se guardará el registro en la base de datos y se notificará al cliente. Esta acción no se puede deshacer fácilmente.
                </p>
              </div>
            </div>

            <div className="p-6 bg-gray-50 flex gap-3">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 font-bold rounded-xl hover:bg-white transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmSubmit}
                disabled={submitting}
                className="flex-1 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all disabled:opacity-50"
              >
                {submitting ? 'Emitiendo...' : 'Confirmar y Emitir'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Duplicate Insurance Warning Modal */}
      {showDuplicateModal && duplicateMatch && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in duration-200 border border-amber-200">
            <div className="bg-amber-500 p-6 text-white flex items-center gap-3">
              <AlertTriangle className="w-8 h-8 text-amber-100 shrink-0" />
              <div>
                <h3 className="text-lg font-black">Posible Seguro Duplicado</h3>
                <p className="text-amber-100 text-xs">Ya existe un seguro registrado con estos mismos datos</p>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs text-gray-600 leading-relaxed font-medium">
                Se ha detectado que ya existe un seguro en el sistema con el mismo <span className="font-bold text-gray-900">Nombre, Apellido, Fecha de Nacimiento</span> y <span className="font-bold text-gray-900">Vigencia (Salida y Regreso)</span>:
              </p>

              <div className="bg-amber-50 border border-amber-200/70 p-4 rounded-xl space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-amber-800 font-semibold">Asegurado:</span>
                  <span className="font-bold text-gray-900">{duplicateMatch.firstName} {duplicateMatch.lastName}</span>
                </div>
                {duplicateMatch.birthDate && (
                  <div className="flex justify-between">
                    <span className="text-amber-800 font-semibold">Fecha Nacimiento:</span>
                    <span className="font-medium text-gray-800">{formatDisplayDate(duplicateMatch.birthDate)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-amber-800 font-semibold">Vigencia:</span>
                  <span className="font-bold text-gray-900">{formatDisplayDate(duplicateMatch.startDate)} al {formatDisplayDate(duplicateMatch.endDate)}</span>
                </div>
                {duplicateMatch.destinationCountry && (
                  <div className="flex justify-between">
                    <span className="text-amber-800 font-semibold">Destino:</span>
                    <span className="font-bold text-gray-900">{duplicateMatch.destinationCountry}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-amber-800 font-semibold">Folio / IDseg:</span>
                  <span className="font-bold text-indigo-700 font-mono">{duplicateMatch.IDseg || duplicateMatch.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-amber-800 font-semibold">Estatus Actual:</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-200 text-amber-900">
                    {duplicateMatch.status || 'Registrado'}
                  </span>
                </div>
              </div>

              <p className="text-xs font-bold text-gray-700 text-center pt-2">
                ¿Desea continuar y emitir la póliza de todos modos?
              </p>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowDuplicateModal(false);
                    setDuplicateMatch(null);
                  }}
                  className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl text-xs transition-colors"
                >
                  Cancelar / Revisar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowDuplicateModal(false);
                    setShowConfirmModal(true);
                  }}
                  className="flex-1 py-3 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs shadow-lg shadow-amber-200 transition-colors"
                >
                  Emitir de todos modos
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
