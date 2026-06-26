import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, query, where, orderBy, onSnapshot, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, Policy, Country } from '../types';
import { differenceInYears, differenceInDays, parseISO, format, addDays } from 'date-fns';
import { 
  FileText, Mail, Calendar, Phone, User, Users, Globe, 
  ChevronDown, CheckCircle2, AlertCircle, Download, Send, 
  Percent, Plus, Trash2, ArrowLeft, Loader2, DollarSign, Tag, Info,
  Search, RefreshCw
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { COUNTRIES, APP_LOGO } from '../constants';
import { useCompany } from '../App';

interface QuoteFormProps {
  profile: UserProfile | null;
}

interface QuoteFormData {
  firstName: string;
  lastName: string;
  email: string;
  birthDate: string;
  phone: string;
  agentId: string;
  startDate: string;
  endDate: string;
  originCountry: string;
  destinationCountry: string;
  notes: string;
  discountType: 'percent' | 'flat';
  discountValue: number;
}

export default function QuoteForm({ profile }: QuoteFormProps) {
  const { settings: companySettings } = useCompany();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [agents, setAgents] = useState<UserProfile[]>([]);
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<string[]>([]);
  
  const [formData, setFormData] = useState<QuoteFormData>({
    firstName: '',
    lastName: '',
    email: '',
    birthDate: '',
    phone: '',
    agentId: '',
    startDate: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
    endDate: format(addDays(new Date(), 8), 'yyyy-MM-dd'),
    originCountry: 'MX',
    destinationCountry: 'US',
    notes: '',
    discountType: 'percent',
    discountValue: 0
  });

  const [loading, setLoading] = useState(true);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState<{ type: 'success' | 'error' | null; message: string }>({ type: null, message: '' });

  // Quotes history states
  const [quotesHistory, setQuotesHistory] = useState<any[]>([]);
  const [historySearch, setHistorySearch] = useState('');
  const [selectedPlanFilter, setSelectedPlanFilter] = useState('');
  const [selectedPolicyNameFilter, setSelectedPolicyNameFilter] = useState('');
  const [downloadingQuoteId, setDownloadingQuoteId] = useState<string | null>(null);

  // States for the insurance plan selector filters
  const [selectorPlanFilter, setSelectorPlanFilter] = useState('');
  const [selectorPolicyNameFilter, setSelectorPolicyNameFilter] = useState('');

  // Compute unique plans and unique policy names for the filter dropdowns from both current policies and historical quote data
  const uniquePlans = useMemo(() => {
    const plans = new Set<string>();
    // From current policies
    policies.forEach(p => {
      if (p.plan) plans.add(p.plan);
    });
    // From quote history
    quotesHistory.forEach(q => {
      if (q.selectedPolicies) {
        q.selectedPolicies.forEach((p: any) => {
          if (p.plan) plans.add(p.plan);
        });
      }
    });
    return Array.from(plans).sort();
  }, [policies, quotesHistory]);

  const uniquePolicyNames = useMemo(() => {
    const names = new Set<string>();
    // From current policies
    policies.forEach(p => {
      if (p.name) names.add(p.name);
    });
    // From quote history
    quotesHistory.forEach(q => {
      if (q.selectedPolicies) {
        q.selectedPolicies.forEach((p: any) => {
          if (p.name) names.add(p.name);
        });
      }
    });
    return Array.from(names).sort();
  }, [policies, quotesHistory]);

  // Listen to all quotes history
  useEffect(() => {
    const q = query(collection(db, 'quotes'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const history = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setQuotesHistory(history);
    }, (error) => {
      console.error("Error fetching quotes history:", error);
    });

    return () => unsubscribe();
  }, []);

  // Safe client-side filtering by agent role to prevent missing index errors
  const filteredQuotesHistory = useMemo(() => {
    let list = quotesHistory;
    
    // Filter by agent if applicable
    if (profile && profile.role === 'agent') {
      list = list.filter(q => q.agentId === profile.uid);
    }

    // Filter by plan
    if (selectedPlanFilter) {
      list = list.filter(q => 
        q.selectedPolicies && q.selectedPolicies.some((p: any) => p.plan === selectedPlanFilter)
      );
    }

    // Filter by policy name
    if (selectedPolicyNameFilter) {
      list = list.filter(q => 
        q.selectedPolicies && q.selectedPolicies.some((p: any) => p.name === selectedPolicyNameFilter)
      );
    }

    // Filter by search term
    if (historySearch.trim()) {
      const term = historySearch.toLowerCase();
      list = list.filter(q => 
        (q.firstName && q.firstName.toLowerCase().includes(term)) ||
        (q.lastName && q.lastName.toLowerCase().includes(term)) ||
        (q.email && q.email.toLowerCase().includes(term)) ||
        (q.phone && q.phone.toLowerCase().includes(term)) ||
        (q.agentName && q.agentName.toLowerCase().includes(term)) ||
        (q.destinationCountry && q.destinationCountry.toLowerCase().includes(term))
      );
    }

    return list;
  }, [quotesHistory, profile, historySearch, selectedPlanFilter, selectedPolicyNameFilter]);

  // Load active policies & agents
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        // Load active policies
        const policiesSnap = await getDocs(query(collection(db, 'policies'), where('status', '==', 'active')));
        const loadedPolicies = policiesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Policy));
        setPolicies(loadedPolicies);

        // Load agents
        const agentsSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'agent')));
        const loadedAgents = agentsSnap.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile));
        setAgents(loadedAgents);

        // Pre-select current user if they are an agent
        if (profile && profile.role === 'agent') {
          setFormData(prev => ({ ...prev, agentId: profile.uid }));
        } else if (loadedAgents.length > 0) {
          setFormData(prev => ({ ...prev, agentId: loadedAgents[0].uid }));
        }
      } catch (err) {
        console.error("Error loading Quote Form data:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [profile]);

  // Calculate age based on birth date
  const age = useMemo(() => {
    if (!formData.birthDate) return null;
    try {
      return differenceInYears(new Date(), parseISO(formData.birthDate));
    } catch {
      return null;
    }
  }, [formData.birthDate]);

  // Determine current PlanType category based on age
  const calculatedPlanType = useMemo(() => {
    if (age === null) return 'Traveler'; // fallback default
    if (age >= 6 && age <= 25) return 'Student';
    if (age >= 26 && age <= 69) return 'Traveler';
    if (age >= 0 && age < 6) return 'U6';
    if (age >= 70) return 'O70';
    return 'Traveler';
  }, [age]);

  // Determine destination region based on destination country
  const destinationRegion = useMemo(() => {
    if (formData.destinationCountry && ['US', 'CA', 'WW'].includes(formData.destinationCountry.toUpperCase())) {
      return 1; // Zona 1
    }
    return 2; // Zona 2
  }, [formData.destinationCountry]);

  // Compute unique plans and unique policy names for the selector
  const uniqueSelectorPlans = useMemo(() => {
    const plans = new Set<string>();
    policies.forEach(p => {
      if (p.status === 'active' && p.region === destinationRegion) {
        if (p.plan) plans.add(p.plan);
      }
    });
    return Array.from(plans).sort();
  }, [policies, destinationRegion]);

  const uniqueSelectorPolicyNames = useMemo(() => {
    const names = new Set<string>();
    policies.forEach(p => {
      if (p.status === 'active' && p.region === destinationRegion) {
        if (!selectorPlanFilter || p.plan === selectorPlanFilter) {
          if (p.name) names.add(p.name);
        }
      }
    });
    return Array.from(names).sort();
  }, [policies, destinationRegion, selectorPlanFilter]);

  // Reset selector filters if they are no longer valid for the active destinationRegion or selectorPlanFilter
  useEffect(() => {
    if (selectorPlanFilter && !uniqueSelectorPlans.includes(selectorPlanFilter)) {
      setSelectorPlanFilter('');
    }
  }, [destinationRegion, uniqueSelectorPlans, selectorPlanFilter]);

  useEffect(() => {
    if (selectorPolicyNameFilter && !uniqueSelectorPolicyNames.includes(selectorPolicyNameFilter)) {
      setSelectorPolicyNameFilter('');
    }
  }, [destinationRegion, selectorPlanFilter, uniqueSelectorPolicyNames, selectorPolicyNameFilter]);

  // Calculate trip duration (days)
  const days = useMemo(() => {
    if (!formData.startDate || !formData.endDate) return 0;
    try {
      const d = differenceInDays(parseISO(formData.endDate), parseISO(formData.startDate)) + 1;
      return d > 0 ? d : 0;
    } catch {
      return 0;
    }
  }, [formData.startDate, formData.endDate]);

  const months = useMemo(() => {
    if (days <= 39) return 0;
    return Math.ceil(days / 30.4);
  }, [days]);

  // Filter and prioritize recommended policies first
  const sortedPoliciesList = useMemo(() => {
    let list = policies.filter(p => p.region === destinationRegion && p.status === 'active');
    if (selectorPlanFilter) {
      list = list.filter(p => p.plan === selectorPlanFilter);
    }
    if (selectorPolicyNameFilter) {
      list = list.filter(p => p.name === selectorPolicyNameFilter);
    }
    return list.sort((a, b) => {
      const isARecommended = a.plan === calculatedPlanType;
      const isBRecommended = b.plan === calculatedPlanType;
      if (isARecommended && !isBRecommended) return -1;
      if (!isARecommended && isBRecommended) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [policies, calculatedPlanType, destinationRegion, selectorPlanFilter, selectorPolicyNameFilter]);

  // Calculate exact prices for each policy
  const calculatePolicyPrice = (policy: Policy) => {
    if (days <= 0) return 0;
    let basePrice = 0;
    if (days <= 39) {
      basePrice = policy.pricePerDay * days;
    } else {
      const pricePerMonth = policy.pricePerMonth || (policy.pricePerDay * 30);
      basePrice = pricePerMonth * months;
    }
    return Math.round(basePrice * 100) / 100;
  };

  // Selected policies objects
  const selectedPolicies = useMemo(() => {
    return policies.filter(p => selectedPolicyIds.includes(p.id));
  }, [policies, selectedPolicyIds]);

  // Calculate subtotals, discount and total price
  const totals = useMemo(() => {
    let subtotal = 0;
    const items = selectedPolicies.map(p => {
      const price = calculatePolicyPrice(p);
      subtotal += price;
      return { policy: p, price };
    });

    let discountAmount = 0;
    if (formData.discountType === 'percent') {
      discountAmount = subtotal * (formData.discountValue / 100);
    } else {
      discountAmount = formData.discountValue;
    }
    // Round to 2 decimal places
    discountAmount = Math.min(Math.round(discountAmount * 100) / 100, subtotal);
    const grandTotal = Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100);

    return {
      subtotal,
      discountAmount,
      grandTotal,
      items
    };
  }, [selectedPolicies, days, months, formData.discountType, formData.discountValue]);

  const handleTogglePolicy = (policyId: string) => {
    setSelectedPolicyIds(prev => {
      if (prev.includes(policyId)) {
        return prev.filter(id => id !== policyId);
      } else {
        return [...prev, policyId];
      }
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const num = parseFloat(value) || 0;
    setFormData(prev => ({
      ...prev,
      [name]: num >= 0 ? num : 0
    }));
  };

  const getAgentDetails = () => {
    if (formData.agentId === 'me' && profile) return profile;
    return agents.find(a => a.uid === formData.agentId) || profile;
  };

  const selectedAgent = getAgentDetails();

  // Draw Header Logo on pdf (Mimic vector logo style)
  const drawPdfLogo = (doc: jsPDF, x: number, y: number) => {
    // Outer shield body (Dark blue)
    doc.setFillColor(26, 60, 114); // #1a3c72
    doc.rect(x, y, 14, 3, 'F');
    doc.triangle(x, y + 3, x + 14, y + 3, x + 7, y + 14, 'F');

    // Cyan accent inner shield
    doc.setFillColor(34, 186, 201); // #22bac9
    doc.triangle(x + 1.5, y + 4, x + 14 - 1.5, y + 4, x + 7, y + 14 - 2, 'F');

    // White core
    doc.setFillColor(255, 255, 255);
    doc.triangle(x + 3, y + 4.5, x + 14 - 3, y + 4.5, x + 7, y + 14 - 4, 'F');
  };

  // Generate the PDF
  const buildPdfDocument = async (historicQuote?: any) => {
    const doc = new jsPDF();
    
    // Resolve values from historicQuote or local state
    const qFirstName = historicQuote ? historicQuote.firstName : formData.firstName;
    const qLastName = historicQuote ? (historicQuote.lastName || '') : formData.lastName;
    const qEmail = historicQuote ? (historicQuote.email || '') : formData.email;
    const qPhone = historicQuote ? (historicQuote.phone || '') : formData.phone;
    const qBirthDate = historicQuote ? (historicQuote.birthDate || '') : formData.birthDate;
    const qAge = historicQuote ? (historicQuote.age !== undefined ? historicQuote.age : null) : age;
    const qOriginCountry = historicQuote ? (historicQuote.originCountry || 'MX') : formData.originCountry;
    const qDestinationCountry = historicQuote ? (historicQuote.destinationCountry || 'US') : formData.destinationCountry;
    const qStartDate = historicQuote ? (historicQuote.startDate || '') : formData.startDate;
    const qEndDate = historicQuote ? (historicQuote.endDate || '') : formData.endDate;
    const qDays = historicQuote ? (historicQuote.days || 0) : days;
    const qNotes = historicQuote ? (historicQuote.notes || '') : formData.notes;
    
    const qDiscountType = historicQuote ? (historicQuote.discountType || 'percent') : formData.discountType;
    const qDiscountValue = historicQuote ? (historicQuote.discountValue || 0) : formData.discountValue;
    const qDiscountAmount = historicQuote ? (historicQuote.discountAmount || 0) : totals.discountAmount;
    const qSubtotal = historicQuote ? (historicQuote.subtotal || 0) : totals.subtotal;
    const qGrandTotal = historicQuote ? (historicQuote.grandTotal || 0) : totals.grandTotal;

    const agent = historicQuote 
      ? { displayName: historicQuote.agentName || 'Asesor Comercial', email: historicQuote.agentEmail || 'ventas@misegurointernacional.com' } 
      : selectedAgent;

    // Resolve destination region
    const qDestinationRegion = historicQuote 
      ? (['US', 'CA', 'WW'].includes(qDestinationCountry.toUpperCase()) ? 1 : 2)
      : destinationRegion;

    // Resolve plan type
    const qPlanType = historicQuote 
      ? (qAge === null ? 'Traveler' : (qAge >= 6 && qAge <= 25 ? 'Student' : (qAge >= 26 && qAge <= 69 ? 'Traveler' : (qAge >= 0 && qAge < 6 ? 'U6' : 'O70'))))
      : calculatedPlanType;

    // Resolve months
    const qMonths = qDays <= 39 ? 0 : Math.ceil(qDays / 30.4);

    // Header Background Accent
    doc.setFillColor(243, 244, 246); // gray-100
    doc.rect(0, 0, 210, 42, 'F');

    // Load active company logo image
    let logoData: { url: string, width: number, height: number } | null = null;
    const logoUrl = companySettings?.logoUrl || APP_LOGO;
    if (logoUrl) {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = logoUrl;
        await new Promise((resolve) => {
          img.onload = () => resolve(null);
          img.onerror = (e) => {
            console.error("Image load error:", e);
            resolve(null); // resolve with null to continue without throwing
          };
          if (img.complete) {
            resolve(null);
          }
        });
        
        if (img.width > 0 && img.height > 0) {
          const maxDim = 500;
          let w = img.width;
          let h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, w, h);
            logoData = {
              url: canvas.toDataURL('image/png'),
              width: w,
              height: h
            };
          }
        }
      } catch (error) {
        console.error('Error loading logo in buildPdfDocument:', error);
      }
    }

    if (logoData) {
      const ratio = logoData.width / logoData.height;
      const renderHeight = 22; // 22mm height to fit nicely in 42mm header
      const renderWidth = renderHeight * ratio;
      const logoY = (42 - renderHeight) / 2;
      doc.addImage(logoData.url, 'PNG', 14, logoY, renderWidth, renderHeight);
      
      const textX = 14 + renderWidth + 6;
      
      // Header Text
      doc.setTextColor(26, 60, 114); // Primary blue
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('MI SEGURO INTERNACIONAL', textX, 21);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(107, 114, 128); // gray-500
      doc.text('Cotización de Seguro de Viaje Internacional', textX, 28);
    } else {
      // Draw Vector Logo fallback
      drawPdfLogo(doc, 14, 12);

      // Header Text
      doc.setTextColor(26, 60, 114); // Primary blue
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      doc.text('MI SEGURO INTERNACIONAL', 34, 21);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(107, 114, 128); // gray-500
      doc.text('Cotización de Seguro de Viaje Internacional', 34, 28);
    }

    // Quote Info Top Right
    doc.setFontSize(10);
    doc.setTextColor(55, 65, 81); // gray-700
    doc.setFont('helvetica', 'bold');
    doc.text('COTIZACIÓN', 145, 18);
    doc.setFont('helvetica', 'normal');
    doc.text(`Fecha: ${historicQuote ? format(parseISO(historicQuote.createdAt), 'dd/MM/yyyy') : format(new Date(), 'dd/MM/yyyy')}`, 145, 24);
    doc.text(`Válida por: 30 días`, 145, 30);

    // Decorative Separator Line
    doc.setDrawColor(26, 60, 114);
    doc.setLineWidth(1);
    doc.line(14, 42, 196, 42);

    // Prospect Information Section
    doc.setTextColor(26, 60, 114);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('DATOS DEL PROSPECTO', 14, 52);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(55, 65, 81);
    doc.text(`Nombre: ${qFirstName} ${qLastName}`, 14, 60);
    doc.text(`Email: ${qEmail || 'N/A'}`, 14, 66);
    doc.text(`Teléfono: ${qPhone || 'N/A'}`, 14, 72);
    doc.text(`Fecha Nacimiento: ${qBirthDate ? format(parseISO(qBirthDate), 'dd/MM/yyyy') : 'N/A'} (Edad: ${qAge !== null ? `${qAge} años` : 'N/A'})`, 14, 78);

    // Trip Details Section (Top Right)
    doc.setTextColor(26, 60, 114);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('DETALLES DEL VIAJE', 110, 52);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(55, 65, 81);
    const originCountryName = COUNTRIES.find(c => c.code === qOriginCountry)?.name || qOriginCountry;
    const destCountryName = COUNTRIES.find(c => c.code === qDestinationCountry)?.name || qDestinationCountry;

    doc.text(`País Origen: ${originCountryName}`, 110, 60);
    doc.text(`País Destino: ${destCountryName} (Zona ${qDestinationRegion})`, 110, 66);
    doc.text(`Periodo: ${qStartDate ? format(parseISO(qStartDate), 'dd/MM/yyyy') : 'N/A'} al ${qEndDate ? format(parseISO(qEndDate), 'dd/MM/yyyy') : 'N/A'}`, 110, 72);
    doc.text(`Duración Total: ${qDays} días ${qMonths > 0 ? `(~${qMonths} meses)` : ''}`, 110, 78);

    // Policies/Plans Detailed Breakdown
    doc.setTextColor(26, 60, 114);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('PLANES SELECCIONADOS', 14, 92);

    // Map policies correctly for tableBody
    const resolvedItems = historicQuote 
      ? (historicQuote.selectedPolicies || []).map((p: any) => ({
          name: p.name || 'Seguro Internacional',
          plan: p.plan || 'Traveler',
          rateLabel: qDays <= 39
            ? `$${(p.pricePerDay || 0).toFixed(2)} / día`
            : `$${(p.pricePerMonth || (p.pricePerDay || 0) * 30).toFixed(2)} / mes`,
          isMatch: p.plan === qPlanType && p.region === qDestinationRegion,
          price: p.price || 0
        }))
      : totals.items.map(item => {
          const p = item.policy;
          const isMatch = p.plan === calculatedPlanType && p.region === destinationRegion;
          const rateLabel = days <= 39 
            ? `$${p.pricePerDay.toFixed(2)} / día` 
            : `$${(p.pricePerMonth || p.pricePerDay * 30).toFixed(2)} / mes`;
          return {
            name: p.name || 'Seguro Internacional',
            plan: p.plan || 'Traveler',
            rateLabel: rateLabel,
            isMatch: isMatch,
            price: item.price
          };
        });

    const tableBody = resolvedItems.map((item: any, idx: number) => {
      return [
        (idx + 1).toString(),
        item.name,
        item.plan,
        item.rateLabel,
        item.isMatch ? 'Recomendado' : 'Estándar',
        `$${item.price.toFixed(2)} USD`
      ];
    });

    autoTable(doc, {
      startY: 96,
      head: [['#', 'Plan de Seguro', 'Categoría', 'Tarifa Aplicada', 'Estado Plan', 'Precio']],
      body: tableBody,
      headStyles: { fillColor: [26, 60, 114], fontStyle: 'bold' },
      theme: 'striped',
      styles: { fontSize: 9, cellPadding: 4 },
      columnStyles: {
        0: { cellWidth: 8 },
        1: { fontStyle: 'bold' },
        4: { halign: 'center' },
        5: { halign: 'right', fontStyle: 'bold' }
      }
    });

    let currentY = (doc as any).lastAutoTable.finalY + 12;

    // Notes Section
    if (qNotes) {
      doc.setTextColor(26, 60, 114);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('NOTAS Y CONDICIONES:', 14, currentY);
      
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(107, 114, 128); // gray-500
      const splitNotes = doc.splitTextToSize(qNotes, 120);
      doc.text(splitNotes, 14, currentY + 5);
    }

    // Totals Box (Right Aligned)
    doc.setFillColor(249, 250, 251); // gray-50
    doc.rect(130, currentY - 5, 66, 32, 'F');
    doc.setDrawColor(229, 231, 235); // gray-200
    doc.setLineWidth(0.5);
    doc.rect(130, currentY - 5, 66, 32, 'S');

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(107, 114, 128);
    doc.text('Subtotal:', 134, currentY + 1);
    doc.text(`$${qSubtotal.toFixed(2)} USD`, 190, currentY + 1, { align: 'right' });

    doc.text(`Descuento (${qDiscountType === 'percent' ? `${qDiscountValue}%` : 'Fijo'}):`, 134, currentY + 7);
    doc.text(`-$${qDiscountAmount.toFixed(2)} USD`, 190, currentY + 7, { align: 'right' });

    doc.setDrawColor(229, 231, 235);
    doc.line(134, currentY + 12, 192, currentY + 12);

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(26, 60, 114);
    doc.text('Total Cotizado:', 134, currentY + 19);
    doc.text(`$${qGrandTotal.toFixed(2)} USD`, 190, currentY + 19, { align: 'right' });

    // Agent Signature Footer
    const footerY = 260;
    doc.setDrawColor(229, 231, 235);
    doc.line(14, footerY - 5, 196, footerY - 5);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(26, 60, 114);
    doc.text('ATENDIDO POR:', 14, footerY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(55, 65, 81);
    doc.text(`Agente: ${agent?.displayName || 'Asesor Comercial'}`, 14, footerY + 5);
    doc.text(`Email: ${agent?.email || 'ventas@misegurointernacional.com'}`, 14, footerY + 9);

    // Terms Notice
    doc.setFontSize(8);
    doc.setTextColor(156, 163, 175); // gray-400
    doc.text('Esta es una cotización informativa y no constituye una póliza activa.', 110, footerY + 5);
    doc.text('Sujeta a términos y condiciones generales de la compañía aseguradora.', 110, footerY + 9);

    return doc;
  };

  const saveQuoteToHistory = async (status: 'downloaded' | 'sent') => {
    try {
      const selectedPoliciesData = selectedPolicies.map(p => ({
        id: p.id,
        name: p.name,
        plan: p.plan,
        pricePerDay: p.pricePerDay || 0,
        pricePerMonth: p.pricePerMonth || null,
        region: p.region || null,
        price: calculatePolicyPrice(p)
      }));

      const quoteData = {
        firstName: formData.firstName,
        lastName: formData.lastName || '',
        email: formData.email || '',
        phone: formData.phone || '',
        birthDate: formData.birthDate || '',
        age: age,
        originCountry: formData.originCountry,
        destinationCountry: formData.destinationCountry,
        startDate: formData.startDate,
        endDate: formData.endDate,
        days: days,
        notes: formData.notes || '',
        discountType: formData.discountType,
        discountValue: formData.discountValue,
        discountAmount: totals.discountAmount,
        subtotal: totals.subtotal,
        grandTotal: totals.grandTotal,
        agentId: selectedAgent?.uid || profile?.uid || '',
        agentName: selectedAgent?.displayName || profile?.displayName || 'Asesor Comercial',
        agentEmail: selectedAgent?.email || profile?.email || '',
        selectedPolicies: selectedPoliciesData,
        status: status,
        createdAt: new Date().toISOString()
      };

      await addDoc(collection(db, 'quotes'), quoteData);
    } catch (err) {
      console.error("Error saving quote to history:", err);
    }
  };

  const handleDownloadPDF = async () => {
    if (!formData.firstName) {
      alert("Por favor ingrese al menos el nombre para generar la cotización.");
      return;
    }
    if (selectedPolicyIds.length === 0) {
      alert("Por favor seleccione al menos un seguro para realizar la cotización.");
      return;
    }
    const docPdf = await buildPdfDocument();
    docPdf.save(`Cotizacion_${formData.firstName}_${formData.lastName || ''}.pdf`);
    await saveQuoteToHistory('downloaded');
  };

  const handleDownloadHistoricPDF = async (quote: any) => {
    try {
      setDownloadingQuoteId(quote.id);
      const docPdf = await buildPdfDocument(quote);
      docPdf.save(`Cotizacion_${quote.firstName}_${quote.lastName || ''}.pdf`);
    } catch (err) {
      console.error("Error generating historic PDF:", err);
      alert("No se pudo generar el PDF de la cotización histórica.");
    } finally {
      setDownloadingQuoteId(null);
    }
  };

  const handleDeleteQuote = async (quoteId: string) => {
    if (!window.confirm("¿Está seguro de que desea eliminar esta cotización del historial?")) {
      return;
    }
    try {
      await deleteDoc(doc(db, 'quotes', quoteId));
    } catch (err) {
      console.error("Error deleting quote:", err);
      alert("Error al eliminar la cotización.");
    }
  };

  const handleLoadQuote = (quote: any) => {
    setFormData({
      firstName: quote.firstName || '',
      lastName: quote.lastName || '',
      email: quote.email || '',
      birthDate: quote.birthDate || '',
      phone: quote.phone || '',
      agentId: quote.agentId || '',
      startDate: quote.startDate || format(addDays(new Date(), 1), 'yyyy-MM-dd'),
      endDate: quote.endDate || format(addDays(new Date(), 8), 'yyyy-MM-dd'),
      originCountry: quote.originCountry || 'MX',
      destinationCountry: quote.destinationCountry || 'US',
      notes: quote.notes || '',
      discountType: quote.discountType || 'percent',
      discountValue: quote.discountValue || 0
    });
    
    if (quote.selectedPolicies) {
      const policyIds = quote.selectedPolicies.map((p: any) => p.id).filter(Boolean);
      setSelectedPolicyIds(policyIds);
    }
    
    // Scroll smoothly to form top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSendEmail = async () => {
    if (!formData.firstName) {
      setEmailStatus({ type: 'error', message: 'Por favor ingrese el nombre del prospecto.' });
      return;
    }
    if (!formData.email) {
      setEmailStatus({ type: 'error', message: 'Por favor ingrese el correo electrónico del prospecto para enviarle la cotización.' });
      return;
    }
    if (selectedPolicyIds.length === 0) {
      setEmailStatus({ type: 'error', message: 'Por favor seleccione al menos un plan para cotizar.' });
      return;
    }

    setSendingEmail(true);
    setEmailStatus({ type: null, message: '' });

    try {
      const docPdf = await buildPdfDocument();
      const pdfBase64 = docPdf.output('datauristring').split(',')[1];

      const mailBody = `Hola ${formData.firstName},\n\n` +
        `Es un placer saludarte. Adjunto a este correo encontrarás la cotización para tu seguro de viaje internacional.\n\n` +
        `Detalles de tu viaje:\n` +
        `- Duración: ${days} días\n` +
        `- Destino: ${COUNTRIES.find(c => c.code === formData.destinationCountry)?.name || formData.destinationCountry}\n` +
        `- Total: $${totals.grandTotal.toFixed(2)} USD\n\n` +
        (formData.notes ? `Nota: ${formData.notes}\n\n` : '') +
        `Si tienes alguna duda o deseas proceder con la contratación, por favor no dudes en contactarme.\n\n` +
        `Atentamente,\n` +
        `${selectedAgent?.displayName || 'Asesor Comercial'}\n` +
        `Mi Seguro Internacional\n` +
        `Email: ${selectedAgent?.email || ''}`;

      const bccList = selectedAgent?.email ? [selectedAgent.email] : [];

      const response = await fetch('/api/send-certificate', {
         method: 'POST',
         headers: {
           'Content-Type': 'application/json',
         },
         body: JSON.stringify({
           to: [formData.email],
           bcc: bccList,
           subject: `Cotización de Seguro de Viaje - ${formData.firstName} ${formData.lastName}`,
           body: mailBody,
           pdfs: [
             {
               filename: `Cotizacion_${formData.firstName}_${formData.lastName || 'Seguro'}.pdf`,
               data: pdfBase64,
             },
           ],
         }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'No se pudo enviar el correo.');
      }

      setEmailStatus({
        type: 'success',
        message: `¡Cotización enviada con éxito a ${formData.email}! Se incluyó copia oculta para el agente (${selectedAgent?.email || 'N/A'}).`
      });

      await saveQuoteToHistory('sent');
    } catch (err: any) {
      console.error("Error sending quote email:", err);
      setEmailStatus({
        type: 'error',
        message: `Error al enviar correo: ${err.message}`
      });
    } finally {
      setSendingEmail(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] py-12">
        <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
        <p className="text-gray-500 font-bold text-sm">Cargando base de datos de seguros y agentes...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-in fade-in-50 duration-500">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-blue-700 to-indigo-800 rounded-3xl p-6 sm:p-8 text-white mb-8 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-2xl -mr-16 -mt-16" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="bg-blue-500/20 text-blue-200 text-xs font-black uppercase px-3 py-1 rounded-full border border-blue-400/20 tracking-wider">
                Nueva Herramienta
              </span>
            </div>
            <h1 className="text-3xl font-black tracking-tight">Cotizar Seguro</h1>
            <p className="text-blue-100 mt-2 font-medium max-w-2xl text-sm sm:text-base">
              Calcula tarifas para múltiples planes de seguro de manera simultánea, aplica descuentos personalizados, genera cotizaciones en PDF y envíalas directamente por correo electrónico a tus prospectos.
            </p>
          </div>
        </div>
      </div>

      {/* Grid Container */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left/Middle Column: Form Fields and Policy Selector */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Prospect & Agent Info Form */}
          <div className="bg-white rounded-3xl p-6 sm:p-8 border border-gray-100 shadow-md">
            <h2 className="text-lg font-black text-gray-900 mb-6 flex items-center gap-2 border-b border-gray-100 pb-4">
              <User className="w-5 h-5 text-blue-600" />
              <span>Datos Generales de la Cotización</span>
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-black text-gray-700 uppercase tracking-wide mb-2">Nombre *</label>
                <div className="relative">
                  <User className="absolute left-4 top-3.5 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    name="firstName"
                    value={formData.firstName}
                    onChange={handleInputChange}
                    placeholder="Ej. Juan"
                    className="pl-11 w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-bold"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-gray-700 uppercase tracking-wide mb-2">Apellidos</label>
                <div className="relative">
                  <User className="absolute left-4 top-3.5 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    name="lastName"
                    value={formData.lastName}
                    onChange={handleInputChange}
                    placeholder="Ej. Pérez"
                    className="pl-11 w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-gray-700 uppercase tracking-wide mb-2">Email del Cliente *</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-3.5 w-4 h-4 text-gray-400" />
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    placeholder="cliente@ejemplo.com"
                    className="pl-11 w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-gray-700 uppercase tracking-wide mb-2">Teléfono</label>
                <div className="relative">
                  <Phone className="absolute left-4 top-3.5 w-4 h-4 text-gray-400" />
                  <input
                    type="tel"
                    name="phone"
                    value={formData.phone}
                    onChange={handleInputChange}
                    placeholder="+52 55 1234 5678"
                    className="pl-11 w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-gray-700 uppercase tracking-wide mb-2">Fecha Nacimiento</label>
                <div className="relative">
                  <Calendar className="absolute left-4 top-3.5 w-4 h-4 text-gray-400" />
                  <input
                    type="date"
                    name="birthDate"
                    value={formData.birthDate}
                    onChange={handleInputChange}
                    className="pl-11 w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-bold"
                  />
                </div>
                {age !== null && (
                  <p className="text-xs text-blue-600 font-bold mt-1.5 flex items-center gap-1">
                    <Info className="w-3.5 h-3.5" />
                    Edad calculada: {age} años (Categoría: {calculatedPlanType === 'U6' ? 'Menor de 6 años' : calculatedPlanType === 'Student' ? 'Estudiante' : calculatedPlanType === 'Traveler' ? 'Viajero' : 'Mayor de 70 años'})
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-black text-gray-700 uppercase tracking-wide mb-2">Asignar Agente</label>
                <div className="relative">
                  <Users className="absolute left-4 top-3.5 w-4 h-4 text-gray-400" />
                  <select
                    name="agentId"
                    value={formData.agentId}
                    onChange={handleInputChange}
                    className="pl-11 w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-bold appearance-none"
                  >
                    {profile && profile.role !== 'agent' && (
                      <option value="me">Mí mismo ({profile.displayName || profile.email})</option>
                    )}
                    {agents.map(a => (
                      <option key={a.uid} value={a.uid}>
                        {a.displayName || a.email} (Agente)
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-4 top-4 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
              </div>
            </div>
          </div>

          {/* Trip Details Form */}
          <div className="bg-white rounded-3xl p-6 sm:p-8 border border-gray-100 shadow-md">
            <h2 className="text-lg font-black text-gray-900 mb-6 flex items-center gap-2 border-b border-gray-100 pb-4">
              <Globe className="w-5 h-5 text-indigo-600" />
              <span>Itinerario del Viaje</span>
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-black text-gray-700 uppercase tracking-wide mb-2">País de Origen</label>
                <div className="relative">
                  <Globe className="absolute left-4 top-3.5 w-4 h-4 text-gray-400" />
                  <select
                    name="originCountry"
                    value={formData.originCountry}
                    onChange={handleInputChange}
                    className="pl-11 w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-bold appearance-none"
                  >
                    {COUNTRIES.map(c => (
                      <option key={c.code} value={c.code}>{c.name}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-4 top-4 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-gray-700 uppercase tracking-wide mb-2">País de Destino</label>
                <div className="relative">
                  <Globe className="absolute left-4 top-3.5 w-4 h-4 text-gray-400" />
                  <select
                    name="destinationCountry"
                    value={formData.destinationCountry}
                    onChange={handleInputChange}
                    className="pl-11 w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-bold appearance-none"
                  >
                    {COUNTRIES.map(c => (
                      <option key={c.code} value={c.code}>{c.name}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-4 top-4 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
                <p className="text-xs text-indigo-600 font-bold mt-1.5">
                  Región de destino detectada: <span className="font-extrabold underline">Zona {destinationRegion}</span>
                </p>
              </div>

              <div>
                <label className="block text-xs font-black text-gray-700 uppercase tracking-wide mb-2">Fecha de Salida</label>
                <div className="relative">
                  <Calendar className="absolute left-4 top-3.5 w-4 h-4 text-gray-400" />
                  <input
                    type="date"
                    name="startDate"
                    value={formData.startDate}
                    onChange={handleInputChange}
                    className="pl-11 w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-gray-700 uppercase tracking-wide mb-2">Fecha de Regreso</label>
                <div className="relative">
                  <Calendar className="absolute left-4 top-3.5 w-4 h-4 text-gray-400" />
                  <input
                    type="date"
                    name="endDate"
                    value={formData.endDate}
                    onChange={handleInputChange}
                    className="pl-11 w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-bold"
                  />
                </div>
              </div>
            </div>

            {days > 0 ? (
              <div className="mt-6 bg-indigo-50 border border-indigo-100 rounded-2xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-black text-indigo-800 uppercase tracking-wider mb-0.5">Duración Calculada</p>
                  <p className="text-lg font-black text-indigo-900">{days} días en total</p>
                </div>
                {months > 0 && (
                  <div className="bg-indigo-600/10 text-indigo-700 font-bold text-xs px-3 py-1.5 rounded-xl border border-indigo-200">
                    Cálculo Mensual: {months} {months === 1 ? 'Mes' : 'Meses'}
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-6 bg-red-50 border border-red-100 rounded-2xl p-4 flex items-center gap-3 text-red-700">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <p className="text-xs font-bold">La fecha de regreso debe ser posterior o igual a la de salida.</p>
              </div>
            )}
          </div>

          {/* Insurance Selector Grid */}
          <div className="bg-white rounded-3xl p-6 sm:p-8 border border-gray-100 shadow-md">
            <div className="border-b border-gray-100 pb-4 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h2 className="text-lg font-black text-gray-900 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <span>Elegir Planes de Seguro</span>
              </h2>
              <span className="text-xs bg-gray-100 text-gray-600 font-bold px-3 py-1 rounded-full border border-gray-200">
                {sortedPoliciesList.length} Planes Activos
              </span>
            </div>

            {/* Filtros para la selección de planes de seguro */}
            {days > 0 && (
              <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                <div className="relative">
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Filtrar por Plan</label>
                  <select
                    value={selectorPlanFilter}
                    onChange={(e) => setSelectorPlanFilter(e.target.value)}
                    className="px-4 pr-10 w-full bg-white border border-gray-200 rounded-xl py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-bold text-gray-700 appearance-none cursor-pointer"
                  >
                    <option value="">Todos los Planes</option>
                    {uniqueSelectorPlans.map((plan) => (
                      <option key={plan} value={plan}>{plan}</option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute bottom-3 right-4 flex items-center">
                    <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                <div className="relative">
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Filtrar por Póliza</label>
                  <select
                    value={selectorPolicyNameFilter}
                    onChange={(e) => setSelectorPolicyNameFilter(e.target.value)}
                    className="px-4 pr-10 w-full bg-white border border-gray-200 rounded-xl py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-bold text-gray-700 appearance-none cursor-pointer"
                  >
                    <option value="">Todas las Pólizas</option>
                    {uniqueSelectorPolicyNames.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute bottom-3 right-4 flex items-center">
                    <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>
            )}

            {days <= 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-amber-800 text-sm font-bold flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                <span>Establezca fechas de viaje válidas para calcular los precios de los seguros.</span>
              </div>
            )}

            {days > 0 && sortedPoliciesList.length === 0 && (
              <div className="text-center py-8 bg-slate-50 border border-dashed border-gray-200 rounded-2xl">
                <AlertCircle className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                <p className="text-gray-500 font-bold text-xs">No se encontraron planes que coincidan con los filtros seleccionados.</p>
                <p className="text-gray-400 text-[10px] mt-1 font-medium">Prueba limpiando o cambiando los criterios de filtro.</p>
              </div>
            )}

            {days > 0 && sortedPoliciesList.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {sortedPoliciesList.map((p) => {
                  const isSelected = selectedPolicyIds.includes(p.id);
                  const isRecommended = p.plan === calculatedPlanType && p.region === destinationRegion;
                  const calculatedPrice = calculatePolicyPrice(p);

                  return (
                    <div
                      key={p.id}
                      onClick={() => handleTogglePolicy(p.id)}
                      className={`relative cursor-pointer rounded-2xl p-4 border transition-all duration-300 flex flex-col justify-between h-40 ${
                        isSelected
                          ? 'bg-emerald-50/50 border-emerald-500 ring-2 ring-emerald-500/20'
                          : isRecommended
                            ? 'bg-blue-50/20 border-blue-200 hover:border-blue-400 hover:bg-blue-50/30'
                            : 'bg-white border-gray-200 hover:border-gray-400'
                      }`}
                    >
                      {/* Badge Recommendations */}
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-extrabold text-sm text-gray-900 leading-tight block">
                              {p.name}
                            </span>
                            {isRecommended && (
                              <span className="bg-blue-600 text-white text-[8px] font-black uppercase px-2 py-0.5 rounded-full tracking-wider">
                                Recomendado
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] bg-gray-100 text-gray-500 border border-gray-200 font-extrabold px-2 py-0.5 rounded-md mt-1.5 inline-block">
                            Plan: {p.plan} • {p.deductible ? 'Con deducible' : 'Sin deducible'} • Zona {p.region}
                          </span>
                        </div>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}} // handled by div click
                          className="w-4.5 h-4.5 text-emerald-600 bg-gray-50 border-gray-300 rounded focus:ring-emerald-500 focus:ring-2 pointer-events-none"
                        />
                      </div>

                      {/* Pricing Footer of the card */}
                      <div className="border-t border-gray-100 pt-3 flex items-end justify-between mt-2">
                        <div>
                          <span className="text-[10px] text-gray-400 font-bold block uppercase tracking-wider">Tarifa base</span>
                          <span className="text-xs text-gray-600 font-black">
                            {days <= 39 
                              ? `$${p.pricePerDay.toFixed(2)} / día` 
                              : `$${(p.pricePerMonth || p.pricePerDay * 30).toFixed(2)} / mes`
                            }
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] text-gray-400 font-bold block uppercase tracking-wider">Total plan</span>
                          <span className={`text-lg font-black ${isSelected ? 'text-emerald-700' : 'text-gray-900'}`}>
                            ${calculatedPrice.toFixed(2)} <span className="text-xs font-bold">USD</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>

        {/* Right Column: Pricing Summary & Actions */}
        <div className="space-y-8">
          
          {/* Notes and Discount Block */}
          <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-md">
            <h2 className="text-md font-black text-gray-900 mb-4 border-b border-gray-100 pb-3 flex items-center gap-2">
              <Tag className="w-4 h-4 text-amber-600" />
              <span>Descuento & Notas</span>
            </h2>

            {/* Discount Form Fields */}
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-[10px] font-black text-gray-700 uppercase tracking-wide mb-1.5">Tipo de Descuento</label>
                <div className="grid grid-cols-2 gap-2 bg-gray-100 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, discountType: 'percent' }))}
                    className={`py-1.5 px-3 rounded-lg font-extrabold text-xs transition-all ${
                      formData.discountType === 'percent'
                        ? 'bg-white text-blue-700 shadow-sm'
                        : 'text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    Porcentaje (%)
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, discountType: 'flat' }))}
                    className={`py-1.5 px-3 rounded-lg font-extrabold text-xs transition-all ${
                      formData.discountType === 'flat'
                        ? 'bg-white text-blue-700 shadow-sm'
                        : 'text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    Monto Fijo ($)
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-700 uppercase tracking-wide mb-1.5">Valor del Descuento</label>
                <div className="relative">
                  <div className="absolute left-4 top-3 text-gray-400 font-extrabold text-sm">
                    {formData.discountType === 'percent' ? <Percent className="w-4 h-4" /> : <DollarSign className="w-4 h-4" />}
                  </div>
                  <input
                    type="number"
                    name="discountValue"
                    value={formData.discountValue || ''}
                    onChange={handleNumberChange}
                    min="0"
                    placeholder="0.00"
                    className="pl-11 w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-bold"
                  />
                </div>
              </div>
            </div>

            {/* Notes Form Field */}
            <div>
              <label className="block text-[10px] font-black text-gray-700 uppercase tracking-wide mb-1.5">Notas / Observaciones</label>
              <textarea
                name="notes"
                value={formData.notes}
                onChange={handleInputChange}
                rows={3}
                placeholder="Ej. Cobertura completa para deportes recreativos. Cotización calculada para tarifas individuales de verano."
                className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-bold"
              />
            </div>
          </div>

          {/* Pricing Summary Widget */}
          <div className="bg-gradient-to-b from-gray-900 to-slate-900 text-white rounded-3xl p-6 shadow-xl border border-gray-800">
            <h2 className="text-md font-black text-gray-200 mb-6 flex items-center gap-2 border-b border-gray-800 pb-3">
              <DollarSign className="w-4 h-4 text-emerald-400" />
              <span>Resumen de Costos</span>
            </h2>

            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400 font-bold">Subtotal ({selectedPolicyIds.length} planes)</span>
                <span className="font-extrabold text-gray-100">${totals.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400 font-bold">Descuento aplicado</span>
                <span className="font-extrabold text-amber-400">-${totals.discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
              </div>

              <div className="border-t border-gray-800 pt-4 flex items-end justify-between">
                <div>
                  <span className="text-xs text-gray-400 font-black uppercase tracking-wider block">Total Neto</span>
                  <span className="text-gray-400 text-[10px] font-medium block">Válido en Dólares (USD)</span>
                </div>
                <div className="text-right">
                  <span className="text-3xl font-black text-emerald-400">${totals.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  <span className="text-xs font-black text-emerald-400 ml-1">USD</span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="mt-8 space-y-3">
              <button
                type="button"
                onClick={handleDownloadPDF}
                disabled={selectedPolicyIds.length === 0}
                className={`w-full flex items-center justify-center gap-2.5 px-6 py-4 rounded-2xl font-black text-sm transition-all shadow-md ${
                  selectedPolicyIds.length === 0
                    ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                    : 'bg-white text-gray-900 hover:bg-gray-100 hover:scale-[1.01]'
                }`}
              >
                <Download className="w-4 h-4" />
                <span>Descargar PDF</span>
              </button>

              <button
                type="button"
                onClick={handleSendEmail}
                disabled={selectedPolicyIds.length === 0 || sendingEmail}
                className={`w-full flex items-center justify-center gap-2.5 px-6 py-4 rounded-2xl font-black text-sm transition-all shadow-md ${
                  selectedPolicyIds.length === 0 || sendingEmail
                    ? 'bg-blue-800/20 text-blue-400 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700 hover:scale-[1.01]'
                }`}
              >
                {sendingEmail ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Enviando por Correo...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>Enviar Cotización por Correo</span>
                  </>
                )}
              </button>
            </div>

            {/* Email Status Notifications */}
            {emailStatus.type && (
              <div className={`mt-5 p-4 rounded-2xl flex items-start gap-3 border text-xs font-bold animate-in fade-in slide-in-from-top-1 ${
                emailStatus.type === 'success'
                  ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-400'
                  : 'bg-red-950/40 border-red-500/30 text-red-400'
              }`}>
                {emailStatus.type === 'success' ? (
                  <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400 flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-4.5 h-4.5 text-red-400 flex-shrink-0" />
                )}
                <span>{emailStatus.message}</span>
              </div>
            )}
          </div>

        </div>

      </div>

      {/* Historial de Cotizaciones Section */}
      <div className="mt-12 bg-white rounded-3xl p-6 sm:p-8 border border-gray-100 shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-6 mb-6">
          <div>
            <h2 className="text-xl font-black text-gray-900 flex items-center gap-2.5">
              <FileText className="w-6 h-6 text-blue-600" />
              <span>Historial de Cotizaciones</span>
            </h2>
            <p className="text-gray-500 text-xs mt-1.5 font-bold">
              Visualiza, filtra, recupera y vuelve a descargar las cotizaciones enviadas o guardadas por los agentes.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="bg-blue-50 text-blue-700 text-xs font-black px-3 py-1.5 rounded-xl border border-blue-100">
              {filteredQuotesHistory.length} Cotizaciones
            </span>
          </div>
        </div>

        {/* Filter / Search Bar Grid */}
        <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="relative">
            <Search className="absolute left-4 top-3.5 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder="Buscar por cliente, email, teléfono, agente o país..."
              className="pl-11 pr-4 w-full bg-gray-50 border border-gray-200 rounded-2xl py-3 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-bold placeholder-gray-400"
            />
          </div>

          <div className="relative">
            <select
              value={selectedPlanFilter}
              onChange={(e) => setSelectedPlanFilter(e.target.value)}
              className="px-4 pr-10 w-full bg-gray-50 border border-gray-200 rounded-2xl py-3 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-bold text-gray-700 appearance-none cursor-pointer"
            >
              <option value="">Todos los Planes</option>
              {uniquePlans.map((plan) => (
                <option key={plan} value={plan}>{plan}</option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-4 flex items-center">
              <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>

          <div className="relative">
            <select
              value={selectedPolicyNameFilter}
              onChange={(e) => setSelectedPolicyNameFilter(e.target.value)}
              className="px-4 pr-10 w-full bg-gray-50 border border-gray-200 rounded-2xl py-3 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-bold text-gray-700 appearance-none cursor-pointer"
            >
              <option value="">Todas las Pólizas</option>
              {uniquePolicyNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-4 flex items-center">
              <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        </div>

        {/* List / Table Container */}
        {filteredQuotesHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center bg-gray-50/50 rounded-2xl border border-dashed border-gray-200">
            <FileText className="w-12 h-12 text-gray-300 mb-3" />
            <p className="text-gray-500 font-bold text-sm">No se encontraron cotizaciones en el historial.</p>
            <p className="text-gray-400 text-xs mt-1 font-medium">Genera una nueva cotización arriba o ajusta tus filtros.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-gray-100">
            <table className="min-w-full divide-y divide-gray-100 text-left">
              <thead className="bg-gray-50 text-[10px] font-black text-gray-500 uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-4">Fecha</th>
                  <th className="px-6 py-4">Cliente / Prospecto</th>
                  <th className="px-6 py-4">Origen / Destino</th>
                  <th className="px-6 py-4">Cobertura</th>
                  <th className="px-6 py-4">Planes</th>
                  <th className="px-6 py-4">Total</th>
                  <th className="px-6 py-4">Atendido Por</th>
                  <th className="px-6 py-4">Estado</th>
                  <th className="px-6 py-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs font-bold text-gray-700 bg-white">
                {filteredQuotesHistory.map((quote) => {
                  const formattedDate = quote.createdAt 
                    ? format(parseISO(quote.createdAt), 'dd/MM/yyyy HH:mm')
                    : 'N/A';
                  
                  const originName = COUNTRIES.find(c => c.code === quote.originCountry)?.name || quote.originCountry;
                  const destName = COUNTRIES.find(c => c.code === quote.destinationCountry)?.name || quote.destinationCountry;

                  return (
                    <tr key={quote.id} className="hover:bg-gray-50/40 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-gray-500 font-mono">
                        {formattedDate}
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-extrabold text-gray-900">{quote.firstName} {quote.lastName}</div>
                        <div className="text-gray-400 font-medium text-[10px] flex items-center gap-1 mt-0.5">
                          <Mail className="w-3 h-3 flex-shrink-0" />
                          <span>{quote.email || 'N/A'}</span>
                        </div>
                        {quote.phone && (
                          <div className="text-gray-400 font-medium text-[10px] flex items-center gap-1 mt-0.5">
                            <Phone className="w-3 h-3 flex-shrink-0" />
                            <span>{quote.phone}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[10px] text-gray-400 font-medium">De: {originName}</span>
                          <span className="text-gray-900 font-extrabold">A: {destName}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>{quote.days} días</div>
                        <div className="text-[10px] text-gray-400 font-medium mt-0.5">
                          {quote.startDate && format(parseISO(quote.startDate), 'dd/MM/yyyy')} - {quote.endDate && format(parseISO(quote.endDate), 'dd/MM/yyyy')}
                        </div>
                      </td>
                      <td className="px-6 py-4 max-w-xs">
                        <div className="flex flex-col gap-1.5">
                          {(quote.selectedPolicies || []).map((p: any, idx: number) => (
                            <div key={idx} className="bg-slate-50 border border-slate-100 p-1.5 rounded-lg flex flex-col gap-0.5 min-w-[120px]">
                              <span className="text-gray-900 font-extrabold text-[11px] leading-tight">
                                {p.name}
                              </span>
                              <span className="text-blue-600 text-[9px] font-black uppercase tracking-wider">
                                Plan: {p.plan || 'N/A'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-extrabold text-blue-600">
                        ${(quote.grandTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-[10px] text-gray-400 font-bold">USD</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-gray-500 text-[11px]">
                        {quote.agentName || 'Asesor Comercial'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {quote.status === 'sent' ? (
                          <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] px-2 py-1 rounded-lg">
                            Enviada
                          </span>
                        ) : (
                          <span className="bg-blue-50 text-blue-700 border border-blue-200 text-[10px] px-2 py-1 rounded-lg">
                            Descargada
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleLoadQuote(quote)}
                            title="Cargar en Formulario para editar o duplicar"
                            className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDownloadHistoricPDF(quote)}
                            disabled={downloadingQuoteId === quote.id}
                            title="Descargar PDF nuevamente"
                            className="p-2 text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all disabled:opacity-50"
                          >
                            {downloadingQuoteId === quote.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Download className="w-4 h-4" />
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteQuote(quote.id)}
                            title="Eliminar del historial"
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
