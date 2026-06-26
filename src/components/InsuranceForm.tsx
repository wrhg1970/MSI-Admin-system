import React, { useState, useEffect, useMemo } from 'react';
import { collection, addDoc, serverTimestamp, query, getDocs, orderBy, limit, doc, getDoc, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { UserProfile, Policy, PlanType, ClientType, InsuranceRequest, Country, Client, ExchangeRate } from '../types';
import { differenceInYears, differenceInDays, parseISO, format, addDays } from 'date-fns';
import { CheckCircle2, AlertCircle, UserPlus, Users, Building2, User, Globe, FileText, Search, Upload, CreditCard } from 'lucide-react';
import BulkImportModal from './BulkImportModal';
import { useNavigate } from 'react-router-dom';
import TransactionModal from './TransactionModal';
import { triggerWhatsAppNotification } from '../services/whatsapp';
import { COUNTRIES } from '../constants';

interface InsuranceFormProps {
  profile: UserProfile | null;
}

export default function InsuranceForm({ profile }: InsuranceFormProps) {
  const navigate = useNavigate();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [insuranceTypes, setInsuranceTypes] = useState<{name: string, minAge: number, maxAge: number}[]>([]);
  const [actionTypes, setActionTypes] = useState<{action: string, name: string}[]>([]);
  const [exchangeRate, setExchangeRate] = useState<number>(17.5);
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

  const [paymentMethods, setPaymentMethods] = useState<{ id: string; name: string; status: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [createdInsuranceId, setCreatedInsuranceId] = useState<string | null>(null);
  const [showPayModal, setShowPayModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [adjustment, setAdjustment] = useState(0);
  const [error, setError] = useState('');
  const [stripePaymentUrl, setStripePaymentUrl] = useState<string | null>(null);
  const [stripeEmailSent, setStripeEmailSent] = useState<boolean>(false);
  const [stripeLoading, setStripeLoading] = useState<boolean>(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [
          policiesSnap,
          countriesSnap,
          clientsSnap,
          typesSnap,
          actionTypesSnap,
          rateSnap,
          paymentMethodsSnap
        ] = await Promise.all([
          getDocs(query(collection(db, 'policies'))),
          getDocs(query(collection(db, 'countries'), orderBy('name'))),
          getDocs(query(collection(db, 'clients'), orderBy('createdAt', 'desc'))),
          getDocs(query(collection(db, 'insuranceTypes'), orderBy('minAge'))),
          getDocs(query(collection(db, 'actionTypes'), orderBy('action'))),
          getDocs(query(collection(db, 'exchangeRates'), orderBy('date', 'desc'), limit(1))),
          getDocs(query(collection(db, 'paymentMethods')))
        ]);

        setPolicies(policiesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Policy)));
        
        const countriesData = countriesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Country));
        setCountries(countriesData);
        
        setClients(clientsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client)));
        setInsuranceTypes(typesSnap.docs.map(doc => doc.data() as any));
        setActionTypes(actionTypesSnap.docs.map(doc => doc.data() as any));
        setPaymentMethods(paymentMethodsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
        
        if (!rateSnap.empty) {
          const latestRate = rateSnap.docs[0].data() as ExchangeRate;
          setExchangeRate(latestRate.rate);
        }
        
        // Set default countries if they exist in the list
        if (countriesData.length > 0) {
          const defaultOrigin = countriesData.find(c => c.code === 'MX') || countriesData[0];
          const defaultDest = countriesData.find(c => c.code === 'US') || countriesData[0];
          const defaultDestCapital = defaultDest.capital || COUNTRIES.find(c => c.code === defaultDest.code)?.capital || '';
          setFormData(prev => ({
            ...prev,
            originCountry: defaultOrigin.code,
            destinationCountry: defaultDest.code,
            city: prev.city || defaultDestCapital
          }));
        }

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
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'data');
      }
    };
    fetchData();
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

  const selectedClient = useMemo(() => {
    return clients.find(c => c.id === formData.clientId);
  }, [clients, formData.clientId]);

  const age = useMemo(() => {
    if (!formData.birthDate) return 0;
    return differenceInYears(new Date(), parseISO(formData.birthDate));
  }, [formData.birthDate]);

  const planType = useMemo((): PlanType => {
    if (formData.isExtremeSports && age >= 15 && age <= 69) return 'Xtreme';
    if (age >= 6 && age <= 25) return 'Student';
    if (age >= 26 && age <= 69) return 'Traveler';
    if (age >= 0 && age < 6) return 'U6';
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
    return policies.filter(p => p.plan === planType && p.region === destinationRegion && p.status === 'active');
  }, [policies, planType, destinationRegion]);

  const days = useMemo(() => {
    if (!formData.startDate || !formData.endDate) return 0;
    const d = differenceInDays(parseISO(formData.endDate), parseISO(formData.startDate)) + 1;
    return d > 0 ? d : 0;
  }, [formData.startDate, formData.endDate]);

  const months = useMemo(() => {
    if (days <= 39) return 0;
    return Math.ceil(days / 30.4);
  }, [days]);

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
        defaultDiscount: 0 
      };
    }

    let basePrice = 0;
    let totalCost = policy.costPerDay * days;

    if (days <= 39) {
      basePrice = policy.pricePerDay * days;
    } else {
      basePrice = (policy.pricePerMonth || (policy.pricePerDay * 30)) * months;
    }

    // Default discount calculations: Policy Discount & Client Discount (Sequential)
    let defaultDiscount = 0;
    let policyDiscountAmount = 0;
    const clientDiscountPercent = clientExtraDiscountPercent;

    if (months >= 4) {
      if (policy.discountPercentage && policy.discountPercentage > 0) {
        policyDiscountAmount = Math.round((basePrice * (policy.discountPercentage / 100)) * 100) / 100;
      }

      const priceAfterPolicyDiscount = basePrice - policyDiscountAmount;
      let clientDiscountAmount = 0;
      if (clientDiscountPercent > 0) {
        clientDiscountAmount = Math.round((priceAfterPolicyDiscount * (clientDiscountPercent / 100)) * 100) / 100;
      }

      defaultDiscount = policyDiscountAmount + clientDiscountAmount;
    }

    // Calculate commission percentage
    let commissionPercent = 0;
    if (formData.clientType !== 'Individual' && selectedClient?.linkedAgents) {
      const la = selectedClient.linkedAgents.find(a => a.email === formData.linkedAgentId);
      if (la) commissionPercent = la.commission;
    } else if (profile?.role === 'agent') {
      commissionPercent = profile.commission || 0;
    }

    const isCard = formData.paymentMethod === 'Tarjeta AMEX' || formData.paymentMethod === 'Tarjeta VISA/MC';
    const comision = isCard ? Math.round((basePrice * 0.045) * 100) / 100 : 0;

    return {
      basePrice: Math.round(basePrice * 100) / 100,
      cost: Math.round(totalCost * 100) / 100,
      defaultDiscount,
      commissionPercent,
      priceMXP: Math.round((basePrice - defaultDiscount) * exchangeRate * 100) / 100,
      policyDiscountAmount,
      clientDiscountPercent,
      comision,
    };
  }, [policies, formData.policyId, days, months, formData.clientType, selectedClient, formData.linkedAgentId, profile, exchangeRate, clientExtraDiscountPercent, formData.paymentMethod]);

  // Update discount when pricing changes (e.g. policy or client changes)
  useEffect(() => {
    setDiscount(pricing.defaultDiscount || 0);
  }, [pricing.defaultDiscount]);

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

  const handleOpenConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    setShowConfirmModal(true);
  };

  const currentCommission = Math.round(((pricing.basePrice - discount - adjustment) * (pricing.commissionPercent / 100)) * 100) / 100;
  const currentTotal = Math.round((pricing.basePrice - discount - adjustment + (pricing.comision || 0)) * 100) / 100;

  const handleConfirmSubmit = async () => {
    setSubmitting(true);
    setError('');

    try {
      // 1. If Individual and registerAsNewClient is checked, create the client first
      let finalClientId = formData.clientId;
      if (formData.clientType === 'Individual' && formData.registerAsNewClient) {
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

      const { registerAsNewClient, clientId: _, ...restFormData } = formData;

      const selectedPolicy = policies.find(p => p.id === formData.policyId);

      const insurance: any = {
        age,
        days,
        totalPrice: pricing.basePrice,
        totalCost: pricing.cost,
        discount,
        adjustment,
        agentCommission: currentCommission,
        comision: pricing.comision || 0,
        totalFinal: currentTotal,
        totalPaid: 0,
        plan: selectedPolicy?.plan || planType,
        policyName: selectedPolicy?.name || '',
        commissionStatus: currentCommission > 0 ? 'confirmed' : 'pending',
        status: 'pending',
        requestDate: formData.requestDate,
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
        await addDoc(collection(db, 'insuranceActivities'), {
          insuranceId: newId,
          type: 'automatic',
          description: `Se emitió/creó la póliza del seguro para el asegurado ${insurance.firstName} ${insurance.lastName} por un total de $${(insurance.totalFinal || insurance.totalPrice || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })} USD.`,
          date: new Date(),
          createdBy: profile?.email || 'Sistema'
        });
      } catch (e) {
        console.error("Error logging insurance creation:", e);
      }

      // Check if payment method is Stripe
      if (formData.paymentMethod?.toLowerCase().includes('stripe')) {
        setStripeLoading(true);
        try {
          const amountMXP = Math.round(currentTotal * exchangeRate * 100) / 100;
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

          const stripeData = await stripeRes.json();
          if (stripeRes.ok && stripeData.url) {
            setStripePaymentUrl(stripeData.url);
            
            // Auto-send the email with the Stripe payment link
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
          }
        } catch (stripeErr) {
          console.error("Error generating/sending automatic Stripe payment link:", stripeErr);
        } finally {
          setStripeLoading(false);
        }
      }

      setCreatedInsuranceId(newId);
      setSuccess(true);
      setShowConfirmModal(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'insurances');
    } finally {
      setSubmitting(false);
    }
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
            onClick={() => {
              setSuccess(false);
              setCreatedInsuranceId(null);
              setStripePaymentUrl(null);
              setStripeEmailSent(false);
              setFormData({ ...formData, firstName: '', lastName: '', email: '', clientId: '', registerAsNewClient: false });
            }}
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
                className="p-1.5 px-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-xs font-bold text-gray-700 bg-gray-50 focus:bg-white"
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
                    onChange={e => setFormData({ ...formData, actionType: e.target.value })}
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
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Buscar Cliente Existente</label>
                  <div className="relative">
                    <select
                      value={formData.clientId}
                      onChange={e => {
                        const selected = clients.find(c => c.id === e.target.value);
                        if (selected) {
                          setFormData({
                            ...formData,
                            clientId: selected.id || '',
                            firstName: selected.firstName || '',
                            lastName: selected.lastName || '',
                            email: selected.email || '',
                            city: selected.city || '',
                            registerAsNewClient: false
                          });
                        } else {
                          setFormData({ ...formData, clientId: '', registerAsNewClient: false });
                        }
                      }}
                      className="w-full p-2.5 pl-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none appearance-none"
                    >
                      <option value="">Nuevo Cliente (Ingresar datos abajo)</option>
                      {filteredClients.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.firstName} {c.lastName} ({c.email})
                        </option>
                      ))}
                    </select>
                    <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  </div>
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
                className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="ejemplo@correo.com"
              />
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
                  const newAge = differenceInYears(new Date(), parseISO(newBirthDate));
                  setFormData(prev => ({ 
                    ...prev, 
                    birthDate: newBirthDate,
                    isExtremeSports: (newAge >= 15 && newAge <= 69) ? prev.isExtremeSports : false
                  }));
                }}
                className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
              {formData.birthDate && (
                <p className="mt-1 text-xs text-blue-600 font-bold">Edad: {age} años ({planType})</p>
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

            {age >= 15 && age <= 69 && (
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
                {countries.map(c => <option key={c.id} value={c.code}>{c.name}</option>)}
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
                {countries.map(c => <option key={c.id} value={c.code}>{c.name}</option>)}
              </select>
              <p className="mt-1 text-xs text-blue-600 font-bold">Región: {destinationRegion}</p>
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
                    {days} días {months > 0 && `(${months} meses)`}
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
              {paymentMethods
                .filter(m => m.status === 'active')
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(m => (
                  <option key={m.id} value={m.name}>{m.name}</option>
                ))}
            </select>
            <p className="text-[11px] text-gray-400 mt-1">
              Nota: Si se selecciona Tarjeta AMEX o Tarjeta VISA/MC, se sumará automáticamente un cargo de comisión del 4.5% sobre el precio de cobertura.
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
                    ) : months < 4 ? (
                      /* Si el tiempo de viaje es menos de 4 meses, que solo salga el precio de mes */
                      <p className="text-lg font-bold text-indigo-600">${p.pricePerMonth || Math.round(p.pricePerDay * 30)}/mes</p>
                    ) : (
                      /* Si el tiempo de viaje es igual o más de 4 meses, que salga el precio de mes con el descuento disponible */
                      <>
                        <p className="text-lg font-bold text-indigo-600">${p.pricePerMonth || Math.round(p.pricePerDay * 30)}/mes</p>
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
                  <h2 className="text-4xl font-bold">${currentTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h2>
                  <span className="text-xl font-medium text-blue-200">USD</span>
                </div>
                <div className="flex items-baseline gap-2 mt-1 opacity-90">
                  <h3 className="text-2xl font-bold">${(currentTotal * exchangeRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
                  <span className="text-lg font-medium text-blue-200">MXP</span>
                  <span className="text-[10px] bg-blue-500/30 px-2 py-0.5 rounded border border-blue-400/30">TC: {exchangeRate.toFixed(2)}</span>
                </div>
              </div>
              
              <div className="flex flex-wrap gap-2">
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
              disabled={submitting || !formData.policyId || days <= 0 || (formData.clientType !== 'Individual' && !formData.clientId)}
              className="w-full bg-white text-blue-600 font-bold py-4 px-8 rounded-xl hover:bg-blue-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-xl active:scale-95"
            >
              {submitting ? 'Procesando...' : 'Emitir Póliza'}
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
                    <p className="text-sm"><span className="text-gray-500">Solicitud:</span> <span className="font-bold text-gray-900">{formData.requestDate}</span></p>
                    <p className="text-sm"><span className="text-gray-500">Acción:</span> <span className="font-bold text-blue-600">{formData.actionType}</span></p>
                    <p className="text-sm"><span className="text-gray-500">Vigencia:</span> <span className="font-bold text-gray-900">{formData.startDate} al {formData.endDate}</span></p>
                    <p className="text-sm"><span className="text-gray-500">Cobertura:</span> <span className="font-bold text-blue-600">{days} días {months > 0 && `(${months} meses)`}</span></p>
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
                      <span className="font-bold text-gray-900">${pricing.basePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                    </div>

                    <div className="flex justify-between text-sm items-center">
                      <span className="text-gray-500">Descuento:</span>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400">$</span>
                        <input
                          type="number"
                          step="0.01"
                          value={discount}
                          onChange={e => setDiscount(parseFloat(e.target.value) || 0)}
                          className="w-20 p-1 border border-gray-300 rounded text-right font-bold text-green-600 focus:ring-1 focus:ring-green-500 outline-none"
                        />
                      </div>
                    </div>
                    
                    {pricing.clientDiscountPercent > 0 && (
                      <div className="bg-purple-50 p-2.5 rounded-lg border border-purple-100 space-y-1 text-[11px]">
                        <div className="font-semibold text-purple-700 flex justify-between">
                          <span>Descuento de Póliza:</span>
                          <span>-${pricing.policyDiscountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} USD</span>
                        </div>
                        <div className="font-black text-purple-800 flex justify-between">
                          <span>Descuento Extra ({pricing.clientDiscountPercent}%):</span>
                          <span>-${(Math.round((pricing.basePrice - pricing.policyDiscountAmount) * (pricing.clientDiscountPercent / 100) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })} USD</span>
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

                    {pricing.comision > 0 && (
                      <div className="flex justify-between text-sm items-center text-amber-600">
                        <span className="font-bold">Comisión de Pago (4.5%):</span>
                        <span className="font-bold">+${pricing.comision.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                      </div>
                    )}

                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Comisión Agente ({pricing.commissionPercent}%):</span>
                      <span className="font-bold text-indigo-600">${currentCommission.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                    </div>

                    <div className="pt-3 border-t border-gray-100">
                      <div className="flex justify-between items-baseline">
                        <span className="text-gray-900 font-bold">Total Final:</span>
                        <div className="text-right">
                          <p className="text-2xl font-black text-blue-600">${currentTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
                          <p className="text-sm font-bold text-gray-500">${(currentTotal * exchangeRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXP</p>
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
    </div>
  );
}
