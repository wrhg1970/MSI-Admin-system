import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, orderBy, addDoc, serverTimestamp, doc, updateDoc, getDoc, deleteDoc, getDocs, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, auth } from '../firebase';
import { Payment, InsuranceRequest } from '../types';
import { X, DollarSign, Calendar, CreditCard, ArrowRight, Receipt, User, Shield, Plus, AlertCircle, Briefcase, Eye, Printer, FileText, Trash2, Edit2, Copy, RotateCcw } from 'lucide-react';
import { format, isValid } from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ConfirmModal from './ConfirmModal';
import RefundModal from './RefundModal';
import { isCardPaymentMethod } from '../utils/paymentUtils';
import { logInsuranceActivity } from '../utils/activityLogger';

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

const isAlreadyLoaded = (insurance: any) => {
  if (!insurance) return true;
  if (!insurance.createdAt) return true;
  const createdDate = insurance.createdAt.toDate ? insurance.createdAt.toDate() : new Date(insurance.createdAt);
  const cutoffDate = new Date('2026-06-19T17:55:00Z');
  return createdDate < cutoffDate;
};

interface TransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  insuranceId?: string;
  clientEmail?: string;
  title?: string;
  exchangeRate?: number;
  initialShowAddForm?: boolean;
}

export default function TransactionModal({ isOpen, onClose, insuranceId, clientEmail, title, exchangeRate = 17.55, initialShowAddForm = false }: TransactionModalProps) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [insurances, setInsurances] = useState<InsuranceRequest[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<{ id: string; name: string }[]>([]);
  const [currentInsurance, setCurrentInsurance] = useState<InsuranceRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [selectedPaymentForDetail, setSelectedPaymentForDetail] = useState<Payment | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [confirmDeletePayment, setConfirmDeletePayment] = useState<string | null>(null);

  // Stripe States
  const [stripeLoading, setStripeLoading] = useState(false);
  const [stripePaymentUrl, setStripePaymentUrl] = useState<string | null>(null);
  const [stripeCopied, setStripeCopied] = useState(false);
  const [stripeEmailSending, setStripeEmailSending] = useState(false);
  const [stripeEmailSent, setStripeEmailSent] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    amount: '',
    currency: 'USD' as 'USD' | 'MXP',
    type: 'client_payment' as 'client_payment' | 'provider_payment' | 'agent_commission',
    paymentMethod: '',
    receiptNumber: '',
    notes: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    exchangeRate: '20.00',
    status: 'completed' as 'pending' | 'completed'
  });

  // Pre-fill default values when currentInsurance is loaded and form is shown
  useEffect(() => {
    if (isOpen && currentInsurance && showAddForm) {
      const fetchTodayRateAndSet = async () => {
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        let rate = 20.00; // default/fallback rate

        try {
          // Try to get today's exchange rate from DB
          const q = query(
            collection(db, 'exchangeRates'),
            where('date', '==', todayStr),
            limit(1)
          );
          const snap = await getDocs(q);
          if (!snap.empty) {
            const rData = snap.docs[0].data();
            if (rData && rData.rate) {
              rate = parseFloat(rData.rate);
            }
          } else if (exchangeRate) {
            rate = exchangeRate;
          }
        } catch (err) {
          console.error("Error fetching today's exchange rate for prefill:", err);
          if (exchangeRate) {
            rate = exchangeRate;
          }
        }

        const insurancePrice = currentInsurance.totalFinal !== undefined && currentInsurance.totalFinal !== null
          ? currentInsurance.totalFinal
          : (currentInsurance.totalPrice || 0);
        
        // Price * rate = Monto
        const calculatedAmount = (insurancePrice * rate).toFixed(2);

        setFormData({
          amount: calculatedAmount,
          currency: 'MXP',
          type: 'client_payment',
          paymentMethod: currentInsurance.paymentMethod || '',
          receiptNumber: '',
          notes: '',
          date: todayStr,
          exchangeRate: rate.toFixed(2),
          status: 'completed'
        });
      };

      fetchTodayRateAndSet();
    }
  }, [isOpen, currentInsurance, showAddForm, exchangeRate]);

  useEffect(() => {
    if (!isOpen) {
      setShowAddForm(false);
      return;
    }

    if (initialShowAddForm) {
      setShowAddForm(true);
    }

    setLoading(true);
    let unsubPayments: () => void = () => {};
    let unsubInsurances: () => void = () => {};

    if (insuranceId) {
      let directPayments: Payment[] = [];
      let cancelPayments: Payment[] = [];

      const updateCombinedPayments = () => {
        const map = new Map<string, Payment>();
        directPayments.forEach(p => p.id && map.set(p.id, p));
        cancelPayments.forEach(p => p.id && map.set(p.id, p));
        const combined = Array.from(map.values()).sort((a, b) => {
          const dateA = a.date?.toDate ? a.date.toDate().getTime() : new Date(a.date).getTime();
          const dateB = b.date?.toDate ? b.date.toDate().getTime() : new Date(b.date).getTime();
          return dateB - dateA;
        });
        setPayments(combined);
        setLoading(false);
        if (combined.length === 0 || initialShowAddForm) {
          setShowAddForm(true);
        }
      };

      const q = query(
        collection(db, 'payments'),
        where('insuranceId', '==', insuranceId),
        orderBy('date', 'desc')
      );
      unsubPayments = onSnapshot(q, (snap) => {
        directPayments = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Payment));
        updateCombinedPayments();
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, `payments for insurance ${insuranceId}`);
        setLoading(false);
      });

      let unsubCancel: () => void = () => {};
      try {
        const qCancel = query(
          collection(db, 'payments'),
          where('originalInsuranceId', '==', insuranceId)
        );
        unsubCancel = onSnapshot(qCancel, (snap) => {
          cancelPayments = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Payment));
          updateCombinedPayments();
        }, (err) => {
          console.warn("Could not query cancellation payments by originalInsuranceId:", err);
        });
      } catch (err) {
        console.warn("Error setting up cancellation payment listener:", err);
      }

      // Fetch current insurance to check balance
      const unsubIns = onSnapshot(doc(db, 'insurances', insuranceId), (snap) => {
        if (snap.exists()) {
          setCurrentInsurance({ id: snap.id, ...snap.data() } as InsuranceRequest);
        }
      }, (error) => handleFirestoreError(error, OperationType.GET, `insurance/${insuranceId}`));

      return () => {
        unsubPayments();
        unsubCancel();
        unsubIns();
      };
    } else if (clientEmail) {
      // For client, we first need their insurances to get the IDs, 
      // OR we can query payments if we added clientEmail to payments.
      // Since we don't have clientEmail in payments, we query insurances first.
      const qIns = query(
        collection(db, 'insurances'),
        where('email', '==', clientEmail)
      );
      
      unsubInsurances = onSnapshot(qIns, (insSnap) => {
        const insData = insSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsuranceRequest));
        setInsurances(insData);
        const insIds = insData.map(i => i.id).filter(Boolean) as string[];

        if (insIds.length > 0) {
          // Firestore 'in' query limit is 10, but let's assume it's fine for now or handle chunks
          const qPay = query(
            collection(db, 'payments'),
            where('insuranceId', 'in', insIds.slice(0, 10)),
            orderBy('date', 'desc')
          );
          unsubPayments = onSnapshot(qPay, (paySnap) => {
            setPayments(paySnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Payment)));
            setLoading(false);
          }, (error) => {
            handleFirestoreError(error, OperationType.GET, `payments for client ${clientEmail}`);
            setLoading(false);
          });
        } else {
          setPayments([]);
          setLoading(false);
        }
      }, (error) => handleFirestoreError(error, OperationType.GET, `insurances for client ${clientEmail}`));
    }

    return () => {
      unsubPayments();
      unsubInsurances();
    };
  }, [isOpen, insuranceId, clientEmail]);

  useEffect(() => {
    if (!isOpen) return;
    const unsub = onSnapshot(query(collection(db, 'paymentMethods'), where('status', '==', 'active')), (snap) => {
      setPaymentMethods(snap.docs.map(doc => ({ id: doc.id, name: doc.data().name })));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'paymentMethods');
    });
    return () => unsub();
  }, [isOpen]);

  const handleCreateStripePaymentLink = async () => {
    const insuranceObj = currentInsurance || (insurances && insurances[0]);
    if (!insuranceObj || !formData.amount) return;
    
    setStripeLoading(true);
    setStripePaymentUrl(null);
    setStripeEmailSent(false);

    try {
      const amountVal = parseFloat(formData.amount) || 0;
      const rateVal = parseFloat(formData.exchangeRate) || exchangeRate || 17.55;
      
      // If currency is MXP, the amount parameter sent to Stripe should be in pesos.
      // If currency is USD, the amount parameter sent to Stripe should be in USD.
      const sendAmount = formData.currency === 'USD' ? amountVal : amountVal;
      // Wait! If currency is MXP, the amountVal is already in MXP!
      // If currency is USD, the amountVal is in USD. So we just pass amountVal!
      // Let's verify: formData.amount is what they typed. If currency is MXP, they type the MXP amount. So we just use amountVal!
      const actualAmount = amountVal;

      const response = await fetch('/api/stripe/create-payment-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: actualAmount,
          currency: formData.currency,
          description: `Abono Póliza #${insuranceObj.policyNumber || insuranceObj.id?.substring(0,6)} - ${insuranceObj.firstName} ${insuranceObj.lastName}`,
          clientEmail: insuranceObj.email || '',
          insuranceId: insuranceObj.id,
          origin: window.location.origin
        })
      });

      const data = await response.json();
      if (response.ok && data.url) {
        setStripePaymentUrl(data.url);
      } else {
        alert(data.error || 'Error al generar la liga de pago.');
      }
    } catch (error: any) {
      console.error('Error generating stripe link:', error);
      alert('Error de conexión al generar la liga de pago: ' + error.message);
    } finally {
      setStripeLoading(false);
    }
  };

  const handleSendStripeEmail = async () => {
    const insuranceObj = currentInsurance || (insurances && insurances[0]);
    if (!insuranceObj || !stripePaymentUrl || !formData.amount) return;

    setStripeEmailSending(true);
    setStripeEmailSent(false);

    try {
      const amountVal = parseFloat(formData.amount) || 0;
      const actualAmount = amountVal;

      const response = await fetch('/api/stripe/send-payment-link-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: insuranceObj.email || '',
          clientName: `${insuranceObj.firstName} ${insuranceObj.lastName}`,
          paymentUrl: stripePaymentUrl,
          amount: actualAmount,
          currency: formData.currency,
          description: `Abono de Póliza #${insuranceObj.policyNumber || insuranceObj.id?.substring(0,6)}`
        })
      });

      const data = await response.json();
      if (response.ok) {
        setStripeEmailSent(true);
      } else {
        alert(data.error || 'Error al enviar la liga por correo.');
      }
    } catch (error: any) {
      console.error('Error sending stripe link email:', error);
      alert('Error de conexión al enviar correo: ' + error.message);
    } finally {
      setStripeEmailSending(false);
    }
  };

  const handleAddPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!insuranceId) return;

    if (currentInsurance && isInsuranceClosed(currentInsurance)) {
      alert('Este registro está cerrado y no se puede modificar.');
      return;
    }

    setIsSubmitting(true);
    try {
      const amount = parseFloat(formData.amount);
      const exchangeRate = parseFloat(formData.exchangeRate);
      const amountMXP = formData.currency === 'MXP' ? amount : amount * exchangeRate;
      const amountUSD = formData.currency === 'USD' ? amount : amount / exchangeRate;

      const parsedDate = new Date(formData.date);
      if (!isValid(parsedDate)) {
        throw new Error('Fecha inválida');
      }

      const newPayment = {
        insuranceId,
        amount: amountUSD,
        currency: 'USD',
        amountMXP: amountMXP,
        exchangeRate: exchangeRate,
        type: formData.type,
        paymentMethod: formData.paymentMethod,
        receiptNumber: formData.receiptNumber,
        status: formData.status,
        date: parsedDate,
        notes: formData.notes,
        createdAt: serverTimestamp()
      };

      await addDoc(collection(db, 'payments'), newPayment);

      // Log activity: Pago registrado
      try {
        const typeLabel = formData.type === 'client_payment' 
          ? 'Cobro a Cliente' 
          : formData.type === 'provider_payment' 
          ? 'Pago a Proveedor' 
          : 'Comisión de Agente';
        await logInsuranceActivity({
          insuranceId: insuranceId,
          type: 'automatic',
          description: `Se registró una transacción de tipo "${typeLabel}" por un valor de $${amountUSD.toLocaleString('es-MX', { minimumFractionDigits: 2 })} USD (${formData.paymentMethod}) con estado "${formData.status === 'completed' ? 'Completado' : 'Pendiente'}".`,
          date: new Date(),
          createdBy: auth.currentUser?.email || 'Sistema'
        });
      } catch (e) {
        console.error("Error logging payment transaction:", e);
      }

      // If it's a client payment, update the insurance totalPaid and status
      if (formData.type === 'client_payment') {
        const insRef = doc(db, 'insurances', insuranceId);
        const insSnap = await getDoc(insRef);
        if (insSnap.exists()) {
          const insData = insSnap.data() as InsuranceRequest;
          const isNewIns = !isAlreadyLoaded(insData);
          const isCard = isCardPaymentMethod(formData.paymentMethod);

          let updatedFields: any = {};
          
          if (formData.status === 'completed') {
            const newTotalPaid = (insData.totalPaid || 0) + amountUSD;
            updatedFields.totalPaid = newTotalPaid;
          }

          if (isNewIns) {
            const insComision = isCard ? Math.round((insData.totalPrice * 0.045) * 100) / 100 : 0;
            const insTotalFinal = Math.round((insData.totalPrice - (insData.discount || 0) - (insData.adjustment || 0) + insComision) * 100) / 100;
            
            updatedFields.comision = insComision;
            updatedFields.totalFinal = insTotalFinal;
            updatedFields.paymentMethod = formData.paymentMethod;

            const finalPaid = formData.status === 'completed' ? ((insData.totalPaid || 0) + amountUSD) : (insData.totalPaid || 0);
            
            let newStatus = insData.status;
            if ((insTotalFinal - finalPaid) < 2) {
              newStatus = 'paid';
            } else if (finalPaid > 0) {
              newStatus = 'partially_paid';
            } else {
              newStatus = 'pending';
            }
            updatedFields.status = newStatus;
          } else {
            if (formData.status === 'completed') {
              const newTotalPaid = (insData.totalPaid || 0) + amountUSD;
              const totalPrice = insData.totalFinal || insData.totalPrice;
              let newStatus = insData.status;
              if ((totalPrice - newTotalPaid) < 2) {
                newStatus = 'paid';
              } else if (newTotalPaid > 0) {
                newStatus = 'partially_paid';
              }
              updatedFields.status = newStatus;
            }
          }

          if (Object.keys(updatedFields).length > 0) {
            await updateDoc(insRef, updatedFields);
          }

          const finalStatus = updatedFields.status !== undefined ? updatedFields.status : insData.status;
          if (finalStatus === 'paid' && insData.agentCommission && insData.agentCommission > 0) {
            const hasAgentComm = payments.some(p => p.insuranceId === insuranceId && p.type === 'agent_commission');
            if (!hasAgentComm) {
              await addDoc(collection(db, 'payments'), {
                insuranceId,
                amount: insData.agentCommission,
                currency: 'USD',
                type: 'agent_commission',
                status: 'pending', // Needs confirmation
                date: new Date(),
                notes: 'Comisión generada automáticamente al completar el pago de la póliza',
                createdAt: serverTimestamp()
              });
            }
          }
        }
      }

      setShowAddForm(false);
      setFormData({
        ...formData,
        amount: '',
        receiptNumber: '',
        notes: ''
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'payments');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmCommission = async (paymentId: string) => {
    if (currentInsurance && isInsuranceClosed(currentInsurance)) {
      alert('Este registro está cerrado y no se puede modificar.');
      return;
    }
    try {
      const payRef = doc(db, 'payments', paymentId);
      await updateDoc(payRef, {
        status: 'completed',
        date: new Date()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'confirm commission');
    }
  };

  const handleDeletePayment = async (paymentId: string) => {
    try {
      const payment = payments.find(p => p.id === paymentId);
      if (!payment) return;

      if (payment.insuranceId) {
        const assocIns = currentInsurance || insurances.find(i => i.id === payment.insuranceId);
        if (assocIns && isInsuranceClosed(assocIns)) {
          alert('Este registro está cerrado y no se puede modificar.');
          return;
        }
      }

      await deleteDoc(doc(db, 'payments', paymentId));

      // Log activity: Pago eliminado
      if (payment.insuranceId) {
        try {
          const typeLabel = payment.type === 'client_payment' 
            ? 'Cobro a Cliente' 
            : payment.type === 'provider_payment' 
            ? 'Pago a Proveedor' 
            : 'Comisión de Agente';
          await logInsuranceActivity({
            insuranceId: payment.insuranceId,
            type: 'automatic',
            description: `Se eliminó la transacción de tipo "${typeLabel}" por un valor de $${payment.amount.toLocaleString('es-MX', { minimumFractionDigits: 2 })} USD (${payment.paymentMethod || '-'}).`,
            date: new Date(),
            createdBy: auth.currentUser?.email || 'Sistema'
          });
        } catch (e) {
          console.error("Error logging deleted payment:", e);
        }
      }

      // If it was a client payment, update the insurance totalPaid
      if (payment.type === 'client_payment' && payment.status === 'completed' && payment.insuranceId) {
        const insRef = doc(db, 'insurances', payment.insuranceId);
        const insSnap = await getDoc(insRef);
        if (insSnap.exists()) {
          const insData = insSnap.data() as InsuranceRequest;
          const newTotalPaid = (insData.totalPaid || 0) - payment.amount;
          const totalPrice = insData.totalFinal || insData.totalPrice;
          
          let newStatus = insData.status;
          if (newTotalPaid <= 0) {
            newStatus = 'pending';
          } else if ((totalPrice - newTotalPaid) >= 2) {
            newStatus = 'partially_paid';
          } else {
            newStatus = 'paid';
          }

          await updateDoc(insRef, {
            totalPaid: newTotalPaid,
            status: newStatus
          });
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `payments/${paymentId}`);
    }
  };

  const handleSaveEditedPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPayment) return;

    const oldPayment = payments.find(p => p.id === editingPayment.id);
    if (!oldPayment) return;

    if (oldPayment.insuranceId) {
      const assocIns = currentInsurance || insurances.find(i => i.id === oldPayment.insuranceId);
      if (assocIns && isInsuranceClosed(assocIns)) {
        alert('Este registro está cerrado y no se puede modificar.');
        return;
      }
    }

    setIsSubmitting(true);
    try {

      const { id, ...data } = editingPayment;
      
      // Convert date string to Date object if it's a string
      const processedData = {
        ...data,
        date: typeof data.date === 'string' ? new Date(data.date) : data.date,
        updatedAt: serverTimestamp()
      };

      await updateDoc(doc(db, 'payments', id!), processedData);

      // If it's a client payment and amount changed, update insurance
      if (data.type === 'client_payment' && data.status === 'completed' && data.insuranceId) {
        const insRef = doc(db, 'insurances', data.insuranceId);
        const insSnap = await getDoc(insRef);
        if (insSnap.exists()) {
          const insData = insSnap.data() as InsuranceRequest;
          const diff = data.amount - oldPayment.amount;
          if (diff !== 0) {
            const newTotalPaid = (insData.totalPaid || 0) + diff;
            const totalPrice = insData.totalFinal || insData.totalPrice;
            
            let newStatus = insData.status;
            if ((totalPrice - newTotalPaid) < 2) {
              newStatus = 'paid';
            } else if (newTotalPaid > 0) {
              newStatus = 'partially_paid';
            } else {
              newStatus = 'pending';
            }

            await updateDoc(insRef, {
              totalPaid: newTotalPaid,
              status: newStatus
            });
          }
        }
      }
      setEditingPayment(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `payments/${editingPayment.id}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrintReceipt = (payment: Payment) => {
    const doc = new jsPDF();
    const insurance = insurances.find(i => i.id === payment.insuranceId) || currentInsurance;
    
    // Header
    doc.setFillColor(37, 99, 235); // blue-600
    doc.rect(0, 0, 210, 40, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.text('RECIBO DE PAGO', 105, 25, { align: 'center' });
    
    // Client Info
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('INFORMACIÓN DEL CLIENTE', 20, 55);
    doc.setFont('helvetica', 'normal');
    if (insurance) {
      doc.text(`Nombre: ${insurance.firstName} ${insurance.lastName}`, 20, 65);
      doc.text(`Email: ${insurance.email}`, 20, 72);
      doc.text(`Póliza: ${insurance.policyName || 'N/A'}`, 20, 79);
    }
    
    // Receipt Info
    doc.setFont('helvetica', 'bold');
    doc.text('DETALLES DEL RECIBO', 130, 55);
    doc.setFont('helvetica', 'normal');
    doc.text(`No. Recibo: ${payment.receiptNumber || payment.id?.substring(0, 8).toUpperCase()}`, 130, 65);
    doc.text(`Fecha: ${payment.date?.toDate ? format(payment.date.toDate(), 'dd/MM/yyyy') : format(new Date(payment.date), 'dd/MM/yyyy')}`, 130, 72);
    doc.text(`Método: ${payment.paymentMethod}`, 130, 79);
    
    // Payment Table
    autoTable(doc, {
      startY: 95,
      head: [['Descripción', 'Monto (USD)', 'Estado']],
      body: [
        [
          payment.type === 'client_payment' ? 'Cobro a Cliente' : 
          payment.type === 'agent_commission' ? 'Comisión Agente' : 'Pago a Proveedor',
          `$${payment.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          payment.status.toUpperCase()
        ]
      ],
      headStyles: { fillColor: [37, 99, 235] },
      theme: 'grid'
    });
    
    // Totals
    const finalY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFont('helvetica', 'bold');
    doc.text(`TOTAL PAGADO: $${payment.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`, 130, finalY);
    
    if (payment.amountMXP) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Equivalente a: $${payment.amountMXP.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXP`, 130, finalY + 7);
      doc.text(`(Tipo de Cambio: ${payment.exchangeRate?.toFixed(2)})`, 130, finalY + 12);
    }
    
    // Footer
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text('Gracias por su preferencia.', 105, 280, { align: 'center' });
    doc.text('Este documento es un comprobante de pago oficial.', 105, 285, { align: 'center' });
    
    doc.save(`Recibo_Pago_${payment.id?.substring(0, 8)}.pdf`);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-700 p-6 text-white flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl backdrop-blur-md">
              <DollarSign className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-bold">{title || 'Transacciones de la Póliza'}</h3>
                {(currentInsurance?.actionType === 'CAN' || currentInsurance?.isCancelled) && (
                  <span className="px-2.5 py-0.5 bg-red-500/25 text-red-100 border border-red-400/40 rounded-lg text-xs font-bold">
                    Cancelada
                  </span>
                )}
              </div>
              <p className="text-blue-100 text-xs font-mono">
                {insuranceId ? `Seguro ID: ${insuranceId}` : `Cliente: ${clientEmail}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {insuranceId && !showAddForm && currentInsurance && (
              <>
                {((currentInsurance.totalPaid || 0) - (currentInsurance.totalFinal !== undefined && currentInsurance.totalFinal !== null ? currentInsurance.totalFinal : (currentInsurance.totalPrice || 0))) > 5 && (
                  <button 
                    onClick={() => setShowRefundModal(true)}
                    className="flex items-center gap-2 px-3.5 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl transition-colors text-xs font-bold shadow-xs cursor-pointer hover:scale-[1.02] active:scale-95"
                    title="Dar de alta reembolso por sobrepago"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Dar de Alta Reembolso (${((currentInsurance.totalPaid || 0) - (currentInsurance.totalFinal !== undefined && currentInsurance.totalFinal !== null ? currentInsurance.totalFinal : (currentInsurance.totalPrice || 0))).toFixed(2)} USD)
                  </button>
                )}
                {currentInsurance.actionType !== 'CAN' && !currentInsurance.isCancelled && (currentInsurance.totalPaid || 0) < (currentInsurance.totalFinal || currentInsurance.totalPrice) && (
                  <button 
                    onClick={() => setShowAddForm(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-xl transition-colors text-sm font-bold"
                  >
                    <Plus className="w-4 h-4" />
                    Nuevo Pago
                  </button>
                )}
              </>
            )}
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-full transition-colors">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50">
          {showAddForm ? (
            <div className="max-w-2xl mx-auto bg-white rounded-2xl p-8 border border-gray-100 shadow-sm animate-in slide-in-from-bottom-4 duration-300">
              <div className="flex items-center justify-between mb-6">
                <h4 className="text-lg font-bold text-gray-900">Registrar Nueva Transacción</h4>
                <button onClick={() => setShowAddForm(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {currentInsurance && (
                <div className="mb-6 p-4 bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-xl">
                  <div className="flex items-center gap-2 mb-3 pb-1.5 border-b border-blue-100/65">
                    <Shield className="w-4 h-4 text-blue-600" />
                    <span className="text-[10px] font-bold text-blue-800 uppercase tracking-wider">Información de Cobro & Póliza</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="bg-white p-2.5 rounded-lg border border-blue-50/70 shadow-2xs">
                      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Asegurado</p>
                      <p className="text-xs font-bold text-gray-900 mt-0.5 truncate">
                        {currentInsurance.firstName} {currentInsurance.lastName}
                      </p>
                      <p className="text-[10px] text-gray-500 truncate">{currentInsurance.email}</p>
                    </div>

                    <div className="bg-white p-2.5 rounded-lg border border-blue-50/70 shadow-2xs">
                      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Costo del Seguro</p>
                      <p className="text-sm font-black text-blue-600 mt-0.5">
                        ${((currentInsurance.totalPrice || 0) - (currentInsurance.discount || 0) - (currentInsurance.adjustment || 0)).toLocaleString('es-MX', { minimumFractionDigits: 2 })} USD
                      </p>
                    </div>

                    <div className="bg-white p-2.5 rounded-lg border border-blue-50/70 shadow-2xs">
                      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Comisiones</p>
                      <p className="text-sm font-black text-indigo-600 mt-0.5">
                        ${(currentInsurance.agentCommission || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })} USD
                      </p>
                    </div>

                    {currentInsurance.comision && currentInsurance.comision > 0 ? (
                      <div className="bg-white p-2.5 rounded-lg border border-blue-50/70 shadow-2xs">
                        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Recargo Tarjeta (4.5%)</p>
                        <p className="text-sm font-black text-amber-600 mt-0.5">
                          +${currentInsurance.comision.toLocaleString('es-MX', { minimumFractionDigits: 2 })} USD
                        </p>
                      </div>
                    ) : null}

                    <div className="bg-pink-50 p-2.5 rounded-lg border border-pink-100 shadow-2xs">
                      <p className="text-[9px] font-bold text-pink-700 uppercase tracking-wider">Saldo Pendiente / Monto a Pagar</p>
                      <p className="text-sm font-black text-pink-600 mt-0.5">
                        ${((currentInsurance.totalFinal || currentInsurance.totalPrice || 0) - (currentInsurance.totalPaid || 0)).toLocaleString('es-MX', { minimumFractionDigits: 2 })} USD
                      </p>
                      <p className="text-[9px] text-pink-500 mt-0.5">
                        Ya pagado: ${(currentInsurance.totalPaid || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })} USD
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <form onSubmit={handleAddPayment} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Tipo de Transacción</label>
                    <select 
                      value={formData.type}
                      onChange={(e) => setFormData({...formData, type: e.target.value as any})}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium"
                      required
                    >
                      <option value="client_payment">Cobro a Cliente</option>
                      <option value="provider_payment">Pago a Proveedor</option>
                      <option value="agent_commission">Comisión Agente</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Estado</label>
                    <select 
                      value={formData.status}
                      onChange={(e) => setFormData({...formData, status: e.target.value as any})}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium"
                      required
                    >
                      <option value="completed">Completado</option>
                      <option value="pending">Pendiente</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Monto</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
                      <input 
                        type="number"
                        step="0.01"
                        value={formData.amount}
                        onChange={(e) => {
                          setFormData({...formData, amount: e.target.value});
                          if (formData.paymentMethod?.toLowerCase().includes('stripe')) {
                            setStripePaymentUrl(null);
                            setStripeEmailSent(false);
                          }
                        }}
                        className="w-full pl-8 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold text-lg"
                        placeholder="0.00"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Moneda</label>
                    <select 
                      value={formData.currency}
                      onChange={(e) => setFormData({...formData, currency: e.target.value as any})}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold"
                      required
                    >
                      <option value="USD">USD - Dólares</option>
                      <option value="MXP">MXP - Pesos</option>
                    </select>
                  </div>

                  {formData.currency === 'MXP' && (
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Tipo de Cambio</label>
                      <input 
                        type="number"
                        step="0.01"
                        value={formData.exchangeRate}
                        onChange={(e) => setFormData({...formData, exchangeRate: e.target.value})}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium"
                        required
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Fecha</label>
                    <input 
                      type="date"
                      value={formData.date}
                      onChange={async (e) => {
                        const newDate = e.target.value;
                        setFormData(prev => ({ ...prev, date: newDate }));
                        if (newDate) {
                          try {
                            const q = query(
                              collection(db, 'exchangeRates'),
                              where('date', '==', newDate),
                              limit(1)
                            );
                            const snap = await getDocs(q);
                            if (!snap.empty) {
                              const data = snap.docs[0].data();
                              if (data && data.rate) {
                                setFormData(prev => ({ ...prev, exchangeRate: parseFloat(data.rate).toFixed(2) }));
                              }
                            }
                          } catch (err) {
                            console.error("Error fetching exchange rate:", err);
                          }
                        }
                      }}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium"
                      required
                    />
                  </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Recibo</label>
                      <input 
                        type="text"
                        value={formData.receiptNumber}
                        onChange={(e) => setFormData({...formData, receiptNumber: e.target.value})}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium"
                        placeholder="Número de Recibo"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Método de Pago</label>
                    <select 
                      value={formData.paymentMethod}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFormData({...formData, paymentMethod: val});
                        if (val.toLowerCase().includes('stripe') || val === 'Stripe') {
                          const amountVal = parseFloat(formData.amount) || 0;
                          if (amountVal > 0) {
                            setTimeout(() => {
                              handleCreateStripePaymentLink();
                            }, 100);
                          } else {
                            alert("Por favor ingrese un monto válido para generar la liga de Stripe.");
                          }
                        }
                      }}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium"
                      required
                    >
                      <option value="">Seleccione un método...</option>
                      {paymentMethods.length > 0 ? (
                        paymentMethods.sort((a, b) => a.name.localeCompare(b.name)).map(m => (
                          <option key={m.id} value={m.name}>{m.name}</option>
                        ))
                      ) : (
                        <>
                          <option value="Transferencia">Transferencia</option>
                          <option value="Efectivo">Efectivo</option>
                          <option value="Tarjeta">Tarjeta</option>
                          <option value="Zelle">Zelle</option>
                          <option value="PayPal">PayPal</option>
                          <option value="Descuento comision">Descuento comisión</option>
                        </>
                      )}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Notas / Referencia</label>
                  <textarea 
                    value={formData.notes}
                    onChange={(e) => setFormData({...formData, notes: e.target.value})}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium min-h-[100px]"
                    placeholder="Ej. Referencia bancaria, número de recibo..."
                  />
                </div>



                <div className="flex justify-end gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="px-6 py-3 text-gray-500 font-bold hover:bg-gray-100 rounded-xl transition-colors"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    disabled={isSubmitting}
                    className="px-8 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 disabled:opacity-50 flex items-center gap-2"
                  >
                    {isSubmitting ? (
                      <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Plus className="w-5 h-5" />
                    )}
                    Registrar Pago
                  </button>
                </div>
              </form>
            </div>
          ) : loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-10 h-10 border-4 border-blue-600/20 border-t-blue-600 rounded-full animate-spin" />
              <p className="text-gray-400 text-sm font-medium">Cargando transacciones...</p>
            </div>
          ) : payments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-32 text-center">
              <div className="bg-gray-100 p-8 rounded-full mb-6">
                <Receipt className="w-16 h-16 text-gray-300" />
              </div>
              <h4 className="text-2xl font-bold text-gray-900">Sin transacciones</h4>
              <p className="text-gray-500 max-w-xs mx-auto mt-2 text-lg">No se han encontrado registros de pagos para esta selección.</p>
            </div>
          ) : (
            <div className="space-y-4 max-w-4xl mx-auto">
              {/* Banner de sobrepago si excede los $5 */}
              {currentInsurance && ((currentInsurance.totalPaid || 0) - (currentInsurance.totalFinal !== undefined && currentInsurance.totalFinal !== null ? currentInsurance.totalFinal : (currentInsurance.totalPrice || 0))) > 5 && (
                <div className="p-4.5 bg-gradient-to-r from-blue-50 via-indigo-50/50 to-blue-50 border border-blue-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-2xs">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-blue-600 text-white rounded-xl shadow-2xs shrink-0">
                      <RotateCcw className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs font-bold text-blue-900 uppercase tracking-wider">Saldo de Sobrepago Detectado</h4>
                        <span className="px-2 py-0.5 bg-blue-200 text-blue-800 text-[10px] font-black rounded-full">
                          +${((currentInsurance.totalPaid || 0) - (currentInsurance.totalFinal !== undefined && currentInsurance.totalFinal !== null ? currentInsurance.totalFinal : (currentInsurance.totalPrice || 0))).toFixed(2)} USD
                        </span>
                      </div>
                      <p className="text-xs text-blue-700 mt-0.5">
                        Esta póliza cuenta con un sobrepago acumulado mayor a $5.00 USD. Puedes generar el reembolso correspondiente.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowRefundModal(true)}
                    className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-blue-200 flex items-center gap-2 cursor-pointer whitespace-nowrap hover:scale-[1.02] active:scale-95"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Dar de Alta Reembolso
                  </button>
                </div>
              )}

              {payments.map((payment) => {
                const insurance = insurances.find(i => i.id === payment.insuranceId);
                const isRefund = payment.amount < 0 || String(payment.notes || '').toLowerCase().includes('reembolso');
                return (
                  <div key={payment.id} className="bg-white border border-gray-100 rounded-2xl p-6 hover:shadow-md transition-all flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="flex items-center gap-5">
                      <div className={`p-4 rounded-2xl shadow-sm ${
                        isRefund ? 'bg-purple-50 text-purple-600' :
                        payment.type === 'client_payment' ? 'bg-green-50 text-green-600' :
                        payment.type === 'agent_commission' ? 'bg-indigo-50 text-indigo-600' :
                        'bg-red-50 text-red-600'
                      }`}>
                        {isRefund ? <RotateCcw className="w-6 h-6" /> :
                         payment.type === 'client_payment' ? <User className="w-6 h-6" /> :
                         payment.type === 'agent_commission' ? <Briefcase className="w-6 h-6" /> :
                         <Shield className="w-6 h-6" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-3">
                          <span className="text-base font-bold text-gray-900">
                            {isRefund ? 'Reembolso a Cliente' :
                             payment.type === 'client_payment' ? 'Cobro a Cliente' :
                             payment.type === 'agent_commission' ? 'Comisión Agente' :
                             'Pago a Proveedor'}
                          </span>
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase border ${
                            isRefund ? 'bg-purple-100 text-purple-700 border-purple-200' :
                            payment.status === 'completed' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-yellow-100 text-yellow-700 border-yellow-200'
                          }`}>
                            {isRefund ? 'Reembolso' : payment.status === 'completed' ? 'Completado' : 'Pendiente'}
                          </span>
                          {payment.type === 'agent_commission' && payment.status === 'pending' && (
                            <button 
                              onClick={() => handleConfirmCommission(payment.id!)}
                              className="px-3 py-1 bg-indigo-600 text-white text-[10px] font-bold rounded-lg hover:bg-indigo-700 transition-colors shadow-sm shadow-indigo-100"
                            >
                              Confirmar Comisión
                            </button>
                          )}
                          <div className="flex items-center gap-1">
                            <button 
                              onClick={() => setSelectedPaymentForDetail(payment)}
                              className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="Ver Detalles"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => setEditingPayment({
                                ...payment,
                                date: payment.date?.toDate ? format(payment.date.toDate(), 'yyyy-MM-dd') : format(new Date(payment.date), 'yyyy-MM-dd')
                              } as any)}
                              className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                              title="Editar Pago"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => setConfirmDeletePayment(payment.id!)}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Eliminar Pago"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => handlePrintReceipt(payment)}
                              className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                              title="Imprimir Recibo"
                            >
                              <Printer className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                          <span className="flex items-center gap-1.5">
                            <Calendar className="w-4 h-4 text-gray-400" />
                            {payment.date?.toDate ? format(payment.date.toDate(), 'dd/MM/yyyy') : format(new Date(payment.date), 'dd/MM/yyyy')}
                          </span>
                          <span className="flex items-center gap-1.5">
                            <CreditCard className="w-4 h-4 text-gray-400" />
                            {payment.paymentMethod || 'N/A'}
                          </span>
                          {payment.receiptNumber && (
                            <span className="flex items-center gap-1.5 bg-gray-100 px-2 py-0.5 rounded text-[10px] font-bold text-gray-600">
                              <Receipt className="w-3 h-3" />
                              {payment.receiptNumber}
                            </span>
                          )}
                          {insurance && (
                            <span className="text-blue-600 font-bold bg-blue-50 px-2 py-0.5 rounded text-xs">
                              {insurance.firstName} {insurance.lastName}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right flex flex-col items-end">
                      <p className={`text-xl font-black ${
                        isRefund ? 'text-purple-600' :
                        payment.type === 'client_payment' ? 'text-green-600' :
                        payment.type === 'agent_commission' ? 'text-indigo-600' :
                        'text-red-600'
                      }`}>
                        {payment.amount < 0 ? `-$${Math.abs(payment.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `${payment.type === 'provider_payment' ? '-' : ''}$${payment.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} USD
                      </p>
                      {payment.amountMXP && payment.exchangeRate && (
                        <p className="text-xs text-gray-400 font-bold uppercase mt-1">
                          {payment.amountMXP < 0 ? `-$${Math.abs(payment.amountMXP).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `$${payment.amountMXP.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} MXP <span className="text-[10px] opacity-70">(T.C. {payment.exchangeRate.toFixed(2)})</span>
                        </p>
                      )}
                      {payment.notes && (
                        <div className="flex items-center gap-1.5 mt-2 text-xs text-gray-400 italic bg-gray-50 px-3 py-1 rounded-lg border border-gray-100">
                          <AlertCircle className="w-3 h-3" />
                          <span>{payment.notes}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-6 bg-gray-50 border-t border-gray-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-10 py-3 bg-white border border-gray-200 text-gray-700 font-bold rounded-2xl hover:bg-gray-100 transition-all shadow-sm"
          >
            Cerrar
          </button>
        </div>

        {/* Payment Detail Modal */}
        {selectedPaymentForDetail && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
            <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in duration-200">
              <div className="bg-blue-600 p-6 text-white flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <Receipt className="w-6 h-6" />
                  <h4 className="text-lg font-bold">Detalle del Pago</h4>
                </div>
                <button onClick={() => setSelectedPaymentForDetail(null)} className="p-1 hover:bg-white/20 rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-8 space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">ID Transacción</p>
                    <p className="text-sm font-mono text-gray-600">{selectedPaymentForDetail.id}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Fecha</p>
                    <p className="text-sm font-bold text-gray-900">
                      {selectedPaymentForDetail.date?.toDate ? format(selectedPaymentForDetail.date.toDate(), 'dd/MM/yyyy HH:mm') : format(new Date(selectedPaymentForDetail.date), 'dd/MM/yyyy HH:mm')}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Tipo</p>
                    <p className="text-sm font-bold text-gray-900">
                      {selectedPaymentForDetail.type === 'client_payment' ? 'Cobro a Cliente' : 
                       selectedPaymentForDetail.type === 'agent_commission' ? 'Comisión Agente' : 'Pago a Proveedor'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Método</p>
                    <p className="text-sm font-bold text-gray-900">{selectedPaymentForDetail.paymentMethod}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Recibo</p>
                    <p className="text-sm font-bold text-gray-900">{selectedPaymentForDetail.receiptNumber || '-'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Monto USD</p>
                    <p className="text-xl font-black text-blue-600">${selectedPaymentForDetail.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Estado</p>
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase border ${
                      selectedPaymentForDetail.status === 'completed' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-yellow-100 text-yellow-700 border-yellow-200'
                    }`}>
                      {selectedPaymentForDetail.status}
                    </span>
                  </div>
                </div>

                {selectedPaymentForDetail.amountMXP && (
                  <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Detalle Moneda Local</p>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Monto en MXP:</span>
                      <span className="text-sm font-bold text-gray-900">${selectedPaymentForDetail.amountMXP.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXP</span>
                    </div>
                    <div className="flex justify-between items-center mt-1">
                      <span className="text-sm text-gray-600">Tipo de Cambio:</span>
                      <span className="text-sm font-bold text-gray-900">{selectedPaymentForDetail.exchangeRate?.toFixed(2)}</span>
                    </div>
                  </div>
                )}

                {selectedPaymentForDetail.notes && (
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Notas</p>
                    <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded-xl border border-gray-100 italic">
                      "{selectedPaymentForDetail.notes}"
                    </p>
                  </div>
                )}

                <div className="pt-4 flex gap-3">
                  <button 
                    onClick={() => handlePrintReceipt(selectedPaymentForDetail)}
                    className="flex-1 flex items-center justify-center gap-2 py-3 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition-all shadow-lg shadow-green-100"
                  >
                    <Printer className="w-5 h-5" />
                    Imprimir Recibo
                  </button>
                  <button 
                    onClick={() => setSelectedPaymentForDetail(null)}
                    className="flex-1 py-3 bg-gray-100 text-gray-600 font-bold rounded-xl hover:bg-gray-200 transition-all"
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Edit Payment Modal */}
        {editingPayment && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
            <div className="bg-white rounded-3xl shadow-2xl max-w-2xl md:max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
              <div className="bg-blue-600 p-5 md:p-6 text-white flex justify-between items-center flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/15 rounded-xl">
                    <Edit2 className="w-5 h-5 text-white" />
                  </div>
                  <h3 className="text-lg md:text-xl font-black tracking-tight">Editar Pago</h3>
                </div>
                <button onClick={() => setEditingPayment(null)} className="p-2 hover:bg-white/10 rounded-xl transition-all cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <form onSubmit={handleSaveEditedPayment} className="flex-1 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-2 tracking-wider">Moneda</label>
                      <div className="flex bg-gray-100 p-1 rounded-xl">
                        {(['USD', 'MXP'] as const).map(curr => (
                          <button
                            key={curr}
                            type="button"
                            onClick={() => setEditingPayment({ ...editingPayment, currency: curr })}
                            className={`flex-1 py-2 rounded-lg text-xs font-black transition-all cursor-pointer ${
                              editingPayment.currency === curr ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                            }`}
                          >
                            {curr}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-2 tracking-wider">Monto ({editingPayment.currency})</label>
                      <input 
                        type="number"
                        step="0.01"
                        value={editingPayment.currency === 'USD' ? editingPayment.amount : editingPayment.amountMXP}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          if (editingPayment.currency === 'USD') {
                            setEditingPayment({ ...editingPayment, amount: val, amountMXP: val * (editingPayment.exchangeRate || exchangeRate) });
                          } else {
                            setEditingPayment({ ...editingPayment, amountMXP: val, amount: val / (editingPayment.exchangeRate || exchangeRate) });
                          }
                        }}
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none font-bold text-sm transition-all"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-2 tracking-wider">Tipo de Cambio</label>
                      <input 
                        type="number"
                        step="0.0001"
                        value={editingPayment.exchangeRate}
                        onChange={(e) => {
                          const rate = parseFloat(e.target.value) || 1;
                          if (editingPayment.currency === 'USD') {
                            setEditingPayment({ 
                              ...editingPayment, 
                              exchangeRate: rate,
                              amountMXP: (editingPayment.amount || 0) * rate
                            });
                          } else {
                            setEditingPayment({ 
                              ...editingPayment, 
                              exchangeRate: rate,
                              amount: (editingPayment.amountMXP || 0) / rate
                            });
                          }
                        }}
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none text-sm transition-all font-medium"
                        required
                      />
                    </div>

                    <div className="p-4 bg-blue-50/70 rounded-xl border border-blue-100 flex justify-between items-center shadow-sm">
                      <span className="text-blue-700 font-bold text-xs uppercase tracking-wider">
                        {editingPayment.currency === 'USD' ? 'Equivalente MXP' : 'Equivalente USD'}
                      </span>
                      <span className="text-lg md:text-xl font-black text-blue-800">
                        {editingPayment.currency === 'USD' 
                          ? `$${(editingPayment.amountMXP || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXP`
                          : `$${(editingPayment.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`
                        }
                      </span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-2 tracking-wider">Fecha</label>
                      <input 
                        type="date"
                        value={editingPayment.date as any}
                        onChange={async (e) => {
                          const newDate = e.target.value;
                          setEditingPayment(prev => {
                            if (!prev) return null;
                            return { ...prev, date: newDate as any };
                          });
                          if (newDate) {
                            try {
                              const q = query(
                                collection(db, 'exchangeRates'),
                                where('date', '==', newDate),
                                limit(1)
                              );
                              const snap = await getDocs(q);
                              if (!snap.empty) {
                                const data = snap.docs[0].data();
                                if (data && data.rate) {
                                  const rate = parseFloat(data.rate);
                                  setEditingPayment(prev => {
                                    if (!prev) return null;
                                    if (prev.currency === 'USD') {
                                      return {
                                        ...prev,
                                        exchangeRate: rate,
                                        amountMXP: (prev.amount || 0) * rate
                                      };
                                    } else {
                                      return {
                                        ...prev,
                                        exchangeRate: rate,
                                        amount: (prev.amountMXP || 0) / rate
                                      };
                                    }
                                  });
                                }
                              }
                            } catch (err) {
                              console.error("Error fetching exchange rate during edit:", err);
                            }
                          }
                        }}
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none text-sm transition-all"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-2 tracking-wider">Método de Pago</label>
                      <select 
                        value={editingPayment.paymentMethod}
                        onChange={(e) => setEditingPayment({ ...editingPayment, paymentMethod: e.target.value })}
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none text-sm transition-all font-medium"
                      >
                        <option value="">Seleccione un método...</option>
                        {paymentMethods.length > 0 ? (
                          paymentMethods.sort((a, b) => a.name.localeCompare(b.name)).map(m => (
                            <option key={m.id} value={m.name}>{m.name}</option>
                          ))
                        ) : (
                          <>
                            <option value="Transferencia">Transferencia</option>
                            <option value="Efectivo">Efectivo</option>
                            <option value="Tarjeta">Tarjeta</option>
                            <option value="Zelle">Zelle</option>
                            <option value="PayPal">PayPal</option>
                            <option value="Descuento comision">Descuento comisión</option>
                          </>
                        )}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-2 tracking-wider">Recibo</label>
                      <input 
                        type="text"
                        value={editingPayment.receiptNumber || ''}
                        onChange={(e) => setEditingPayment({ ...editingPayment, receiptNumber: e.target.value })}
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none font-bold text-sm transition-all"
                        placeholder="Número de Recibo"
                      />
                    </div>

                    <div className="col-span-1 md:col-span-2">
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-2 tracking-wider">Notas</label>
                      <textarea 
                        value={editingPayment.notes || ''}
                        onChange={(e) => setEditingPayment({ ...editingPayment, notes: e.target.value })}
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none min-h-[80px] text-sm transition-all"
                        placeholder="Notas opcionales del pago..."
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 px-6 py-4 bg-gray-50 border-t border-gray-150 flex-shrink-0 justify-end">
                  <button
                    type="button"
                    onClick={() => setEditingPayment(null)}
                    className="px-5 py-2.5 border border-gray-200 text-gray-600 font-bold text-xs rounded-xl hover:bg-gray-100 transition-all cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2.5 bg-blue-600 text-white font-black text-xs rounded-xl hover:bg-blue-700 transition-all shadow-md shadow-blue-200 disabled:opacity-50 cursor-pointer"
                  >
                    {isSubmitting ? 'Guardando...' : 'Guardar Cambios'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <ConfirmModal 
          isOpen={!!confirmDeletePayment}
          onClose={() => setConfirmDeletePayment(null)}
          onConfirm={() => confirmDeletePayment && handleDeletePayment(confirmDeletePayment)}
          title="Eliminar Pago"
          message="¿Estás seguro de que deseas eliminar este registro de pago? Esta acción no se puede deshacer y afectará el saldo de la póliza."
          confirmText="Eliminar Pago"
        />

        <RefundModal
          isOpen={showRefundModal}
          onClose={() => setShowRefundModal(false)}
          insurance={currentInsurance}
          overpaymentAmount={currentInsurance ? Math.max(0, (currentInsurance.totalPaid || 0) - (currentInsurance.totalFinal !== undefined && currentInsurance.totalFinal !== null ? currentInsurance.totalFinal : (currentInsurance.totalPrice || 0))) : 0}
        />
      </div>
    </div>
  );
}
