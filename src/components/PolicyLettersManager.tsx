import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, addDoc, doc, updateDoc, deleteDoc, serverTimestamp, getDocs } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Policy, PolicyLetter } from '../types';
import { Plus, Trash2, Edit2, Save, X, FileText, Globe, List, PlusCircle, MinusCircle, Copy, AlertTriangle } from 'lucide-react';
import ConfirmModal from './ConfirmModal';

const LANGUAGE_ORDER = ['es', 'en', 'policy', 'covid', 'fr', 'it', 'de'];

export const sortLettersByLanguage = <T extends { language: string }>(letters: T[]): T[] => {
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

export default function PolicyLettersManager() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [letters, setLetters] = useState<PolicyLetter[]>([]);
  const [editingLetter, setEditingLetter] = useState<Partial<PolicyLetter> | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string>('todos');
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  useEffect(() => {
    const unsubPolicies = onSnapshot(collection(db, 'policies'), (snap) => {
      setPolicies(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Policy)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'policies');
    });

    const unsubLetters = onSnapshot(collection(db, 'policyLetters'), (snap) => {
      setLetters(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as PolicyLetter)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'policyLetters');
    });

    return () => {
      unsubPolicies();
      unsubLetters();
    };
  }, []);

  const activePolicies = policies.filter(p => p.status === 'active');
  const planTypes = [...new Set(policies.map(p => p.plan).filter(Boolean))].sort();

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLetter || !editingLetter.policyId || !editingLetter.language || !editingLetter.title || !editingLetter.content) {
      alert('Por favor completa todos los campos obligatorios (Póliza, Idioma, Título y Contenido)');
      return;
    }

    setSaving(true);
    try {
      const data = {
        policyId: editingLetter.policyId,
        language: editingLetter.language,
        title: editingLetter.title,
        content: editingLetter.content,
        benefits: editingLetter.benefits || [],
        footer: editingLetter.footer || '',
        createdAt: editingLetter.id ? editingLetter.createdAt : serverTimestamp()
      };

      if (editingLetter.id) {
        await updateDoc(doc(db, 'policyLetters', editingLetter.id), data);
      } else {
        await addDoc(collection(db, 'policyLetters'), data);
      }
      setEditingLetter(null);
      setIsAdding(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'policyLetters');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Eliminar Carta',
      message: '¿Estás seguro de eliminar esta plantilla de carta?',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'policyLetters', id));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `policyLetters/${id}`);
        }
      }
    });
  };

  const handleDuplicate = (letter: PolicyLetter) => {
    const { id, createdAt, ...rest } = letter;
    setEditingLetter({
      ...rest,
      title: `${rest.title} (Copia)`
    });
    setIsAdding(true);
  };

  const addBenefit = () => {
    const benefits = [...(editingLetter?.benefits || []), { label: '', value: '', isBold: false }];
    setEditingLetter({ ...editingLetter, benefits });
  };

  const removeBenefit = (index: number) => {
    const benefits = [...(editingLetter?.benefits || [])];
    benefits.splice(index, 1);
    setEditingLetter({ ...editingLetter, benefits });
  };

  const updateBenefit = (index: number, field: string, value: any) => {
    const benefits = [...(editingLetter?.benefits || [])];
    benefits[index] = { ...benefits[index], [field]: value };
    setEditingLetter({ ...editingLetter, benefits });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-semibold">Gestión de Cartas por Póliza</h3>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <List className="w-4 h-4 text-gray-400" />
            <select
              value={selectedPlan}
              onChange={(e) => setSelectedPlan(e.target.value)}
              className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="todos">Todos los Planes</option>
              {planTypes.map(plan => (
                <option key={plan} value={plan}>{plan}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => {
              setIsAdding(true);
              setEditingLetter({
                policyId: '',
                language: 'es',
                title: 'A quien corresponda',
                content: '',
                benefits: [],
                footer: ''
              });
            }}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Nueva Carta
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...new Set(letters.map(l => l.policyId))].filter(policyId => {
          if (selectedPlan === 'todos') return true;
          const policy = policies.find(p => 
            p.id === policyId || 
            (p.CodigoPoliza && p.CodigoPoliza === policyId) ||
            p.name === policyId
          );
          return policy?.plan === selectedPlan;
        }).map((policyId) => {
          const policy = policies.find(p => 
            p.id === policyId || 
            (p.CodigoPoliza && p.CodigoPoliza === policyId) ||
            p.name === policyId
          );
          const policyLetters = sortLettersByLanguage(letters.filter(l => l.policyId === policyId));
          const isArchived = policy?.status === 'archived';
          const isMissing = !policy;
          
          return (
            <div key={policyId} className={`bg-white p-5 rounded-xl border shadow-sm hover:shadow-md transition-all flex flex-col h-full ${isMissing ? 'border-red-200 bg-red-50/10' : isArchived ? 'border-amber-200 opacity-80' : 'border-gray-100'}`}>
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h4 className={`font-bold text-lg ${isMissing ? 'text-red-600' : 'text-gray-900'}`}>
                    {policy ? `${policy.plan} - Región ${policy.region} - ${policy.name}` : 'Póliza No Encontrada'}
                  </h4>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-[10px] text-gray-400 font-mono">{policyId}</p>
                    {isArchived && (
                      <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold uppercase">Archivada</span>
                    )}
                    {isMissing && (
                      <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold uppercase underline decoration-red-300">Desasociada</span>
                    )}
                  </div>
                </div>
                <div className={`p-2 rounded-lg ${isMissing ? 'bg-red-100' : 'bg-blue-50'}`}>
                  {isMissing ? <AlertTriangle className="w-5 h-5 text-red-600" /> : <FileText className="w-5 h-5 text-blue-600" />}
                </div>
              </div>

              {isMissing && (
                <div className="mb-4 p-2 bg-red-50 border border-red-100 rounded-lg">
                  <p className="text-[10px] text-red-600 font-medium leading-tight">
                    ESTE GRUPO DE CARTAS ESTÁ HUÉRFANO. La póliza original fue eliminada o el ID no coincide con los planes actuales.
                  </p>
                </div>
              )}

              <div className="flex-1">
                <p className="text-xs font-bold text-gray-700 mb-2 uppercase tracking-wider">Idiomas Disponibles:</p>
                <div className="flex flex-wrap gap-2">
                  {policyLetters.map((letter) => (
                    <div key={letter.id} className="group relative">
                      <button
                        onClick={() => setEditingLetter(letter)}
                        className="px-3 py-1.5 bg-gray-50 border border-gray-200 text-gray-700 text-xs font-bold rounded-lg hover:bg-blue-50 hover:border-blue-200 hover:text-blue-600 transition-all flex items-center gap-2"
                      >
                        <Globe className="w-3 h-3" />
                        {letter.language === 'es_spain' ? 'ESPAÑA' : 
                         letter.language === 'covid' ? 'CORONAVIRUS' : 
                         letter.language === 'policy' ? 'POLICY' : 
                         letter.language.toUpperCase()}
                      </button>
                      <div className="absolute -top-2 -right-2 hidden group-hover:flex gap-1">
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleDuplicate(letter); }}
                          className="p-1 bg-white border border-gray-100 rounded-md shadow-sm text-green-600 hover:bg-green-50"
                          title="Duplicar"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleDelete(letter.id!); }}
                          className="p-1 bg-white border border-gray-100 rounded-md shadow-sm text-red-600 hover:bg-red-50"
                          title="Eliminar"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={() => {
                      setIsAdding(true);
                      setEditingLetter({
                        policyId: policyId,
                        language: 'es',
                        title: 'A quien corresponda',
                        content: '',
                        benefits: [],
                        footer: ''
                      });
                    }}
                    className="px-3 py-1.5 border border-dashed border-gray-300 text-gray-400 text-xs font-bold rounded-lg hover:border-blue-300 hover:text-blue-500 transition-all flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    Añadir
                  </button>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-gray-50 flex justify-between items-center">
                <span className="text-[10px] text-gray-400">
                  {policyLetters.length} {policyLetters.length === 1 ? 'idioma configurado' : 'idiomas configurados'}
                </span>
                <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded uppercase">
                  {policy?.plan} - R{policy?.region}
                </span>
              </div>
            </div>
          );
        })}
        {letters.length === 0 && (
          <div className="col-span-full py-12 text-center bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No hay cartas configuradas</p>
            <p className="text-xs text-gray-400 mt-1">Agrega una nueva carta para empezar</p>
          </div>
        )}
      </div>

      {editingLetter && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-xl font-bold text-gray-900">
                {isAdding ? 'Nueva Configuración de Carta' : 'Editar Configuración de Carta'}
              </h3>
              <button onClick={() => { setEditingLetter(null); setIsAdding(false); }}>
                <X className="w-6 h-6 text-gray-400 hover:text-gray-600" />
              </button>
            </div>
            <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-8 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Póliza Asociada</label>
                  <select
                    required
                    value={editingLetter.policyId}
                    onChange={e => setEditingLetter({ ...editingLetter, policyId: e.target.value })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    <option value="">Seleccionar Póliza</option>
                    {[...activePolicies].sort((a, b) => {
                      // Sort by plan first, then by name
                      const planCompare = (a.plan || '').localeCompare(b.plan || '');
                      if (planCompare !== 0) return planCompare;
                      return a.name.localeCompare(b.name);
                    }).map(p => (
                      <option key={p.id} value={p.id}>
                        {p.plan} - {p.name} (Región {p.region}{p.deductible ? ' + Deducible' : ''})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Idioma</label>
                  <select
                    required
                    value={editingLetter.language}
                    onChange={e => setEditingLetter({ ...editingLetter, language: e.target.value })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    <option value="es">Español</option>
                    <option value="en">Inglés</option>
                    <option value="policy">Policy</option>
                    <option value="covid">Coronavirus</option>
                    <option value="fr">Francés</option>
                    <option value="it">Italiano</option>
                    <option value="de">Alemán</option>
                    <option value="es_spain">España</option>
                  </select>
                </div>
              </div>

              {editingLetter.language === 'covid' && (
                <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-blue-800">Plantilla Estándar Coronavirus</h4>
                    <p className="text-xs text-blue-600">Aplica el texto oficial requerido para certificados COVID.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const covidContent = `Por medio de la presente, certifico que {nombre}, con fecha de nacimiento en {fecha_nacimiento} adquirió un seguro internacional válido en todo el mundo excepto en su país de residencia oficial, por el siguiente periodo de tiempo {fechas} durante su estancia en {Pais}.

El número de póliza es: {Policy}

Información sobre coronavirus
Seguro médico Internacional : el seguro CareMed cubre los tratamientos médicamente necesarios en caso de enfermedades agudas. Se incluyen enfermedades virales, como el coronavirus, por supuesto. Por lo tanto, se cubrirán los costos de tratamiento debido a una infección por coronavirus. La información también se aplica en caso de una pandemia declarada. Por supuesto, está obligado a mantener el riesgo lo más bajo posible para no poner en peligro la cobertura de su seguro.

This is to certify that the insured {nombre}, Date of Birth: {fecha_nacimiento}, has acquired an international insurance valid worldwide during {dates} during his/her stay in {Pais}.

Under the policy number: {Policy}

Information regarding coronavirus
Travel health insurance: CareMed insurance covers medically necessary treatments in case of acute illnesses. Viral illnesses, such as the coronavirus are included, of course. Therefore, treatment costs due to an infection with coronavirus will be covered. The information also applies in case of a declared pandemic. Of course, you are obliged to keep the risk as low as possible in order not to jeopardize your insurance cover.`;
                      setEditingLetter({
                        ...editingLetter,
                        title: 'CERTIFICADO DE COBERTURA / ENROLLMENT CERTIFICATE',
                        content: covidContent,
                        benefits: [] // Usually covid letters are self-contained
                      });
                    }}
                    className="px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 transition-all flex items-center gap-2"
                  >
                    <Plus className="w-3 h-3" />
                    Aplicar Plantilla
                  </button>
                </div>
              )}

              {editingLetter.language === 'policy' && (
                <div className="bg-indigo-50 border border-indigo-200 p-4 rounded-xl flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-indigo-800">Plantilla ID Card & Confirmation</h4>
                    <p className="text-xs text-indigo-600">Aplica el formato gráfico de ID Card, tabla de confirmación y beneficios.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingLetter({
                        ...editingLetter,
                        title: 'INSURANCE CONFIRMATION / ID CARD',
                        content: 'We hereby confirm that the person listed below is insured with CareMed®.\n\nCareMed insurance policies meet or exceed visa requirements worldwide, such as J1, J2, F1, H2B visa for entry into the USA; a Working Holiday Visa for entry into Australia or New Zealand; Schengen Visa, etc.\n\nCareMed GmbH provides the insured with international travel insurance programs marketed under the CareMed® trademark.\n\nCareMed in co-operation with Cultural Insurance Services International, 1 High Ridge Park, Stamford, CT 06905\nPhone: +1-800-303-8120 FAX: +1 203 3995596 Email: cisiwebadmin@culturalinsurance.com\n\nInsurer: Crum & Forster Segregated PO',
                        benefits: [
                          { label: 'Travel Health Insurance (HA)', value: 'Silver', isBold: true },
                          { label: 'Medical expenses in case of illness, accident and acute illness', value: 'US$ 250,000', isBold: false },
                          { label: 'Deductible options - per injury or illness', value: '€/US$100', isBold: false },
                          { label: 'Choice of physician/hospital', value: 'Any or suggested by the emergency center', isBold: false },
                          { label: 'Emergency dental care - relief of pain', value: 'US$ 250', isBold: false },
                          { label: 'Dental treatment in case of accident', value: 'US$ 750', isBold: false },
                          { label: 'Psychiatric evaluation', value: 'US$ 250', isBold: false },
                          { label: 'Mental / nervous disorder', value: 'US$ 250', isBold: false },
                          { label: 'Medical repatriation', value: 'US$ 50,000', isBold: false },
                          { label: 'Repatriation of remains', value: 'US$ 25,000', isBold: false },
                          { label: 'Out-patient Physiotherapy', value: 'US$ 500', isBold: false },
                          { label: 'Out-patient diagnostic x-ray and lab services', value: 'US$ 500', isBold: false },
                          { label: 'Out-patient diagnostic CAT scans and MRI', value: 'Included', isBold: false },
                          { label: 'Medical Aids', value: 'Included', isBold: false },
                          { label: 'Travel Accident Insurance (I)', value: 'Silver', isBold: true },
                          { label: 'Travel Assistance (T)', value: 'Silver', isBold: true },
                          { label: 'Travel Luggage Insurance (L)', value: 'Silver', isBold: true },
                          { label: 'Travel Third Party Liability Insurance (3)', value: 'Silver', isBold: true }
                        ]
                      });
                    }}
                    className="px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 transition-all flex items-center gap-2"
                  >
                    <Plus className="w-3 h-3" />
                    Aplicar Plantilla
                  </button>
                </div>
              )}

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Título / Saludo</label>
                <input
                  type="text"
                  required
                  value={editingLetter.title}
                  onChange={e => setEditingLetter({ ...editingLetter, title: e.target.value })}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="Ej: A quien corresponda / To whom it may concern"
                />
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest">Contenido de la Carta</label>
                  <span className="text-[10px] text-blue-600 font-bold bg-blue-50 px-2 py-0.5 rounded">Utiliza {} para variables</span>
                </div>
                <textarea
                  required
                  rows={8}
                  value={editingLetter.content}
                  onChange={e => setEditingLetter({ ...editingLetter, content: e.target.value })}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none resize-none font-sans text-sm leading-relaxed"
                  placeholder="Escribe el cuerpo de la carta. Puedes usar variables como {nombre}, {fecha_nacimiento}, {fechas}, {pais}, {id}."
                />
                
                {/* Variable Cheat Sheet */}
                <div className="bg-gray-50/50 rounded-2xl p-4 border border-gray-100">
                  <p className="text-[10px] font-black text-gray-400 uppercase mb-3 tracking-widest">Variables Disponibles</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {[
                      { v: '{nombre}', d: 'Nombre completo' },
                      { v: '{fecha_nacimiento}', d: 'Fecha Nac.' },
                      { v: '{fechas}', d: 'Rango de fechas' },
                      { v: '{destino}', d: 'País destino' },
                      { v: '{plan}', d: 'Nombre plan' },
                      { v: '{id}', d: 'ID Póliza' },
                      { v: '{dias}', d: 'Días totales' },
                      { v: '{poliza}', d: 'Núm. Póliza' }
                    ].map(v => (
                      <div key={v.v} className="flex flex-col">
                        <code className="text-[10px] font-bold text-blue-600">{v.v}</code>
                        <span className="text-[9px] text-gray-400 truncate">{v.d}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Live Preview */}
                <div className="space-y-2 mt-6">
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest">Vista Previa de Formato (Justificado)</label>
                  <div className="p-8 bg-white border border-gray-100 rounded-3xl shadow-inner min-h-[200px] overflow-hidden">
                    <div className="max-w-md mx-auto">
                      <p className="text-gray-800 text-sm leading-[1.8] text-justify whitespace-pre-wrap font-sans">
                        {editingLetter.content || <span className="text-gray-300 italic">Escribe contenido para ver la previa...</span>}
                      </p>
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-400 font-bold italic text-center">Este es el formato que se aplicará en el PDF final</p>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-4">
                  <label className="text-sm font-bold text-gray-700">Tabla de Beneficios</label>
                  <button
                    type="button"
                    onClick={addBenefit}
                    className="text-blue-600 hover:text-blue-700 text-xs font-bold flex items-center gap-1"
                  >
                    <PlusCircle className="w-4 h-4" />
                    Agregar Beneficio
                  </button>
                </div>
                <div className="space-y-3">
                  {editingLetter.benefits?.map((benefit, idx) => (
                    <div key={idx} className="flex gap-3 items-start bg-gray-50 p-3 rounded-xl border border-gray-100">
                      <div className="flex-1">
                        <input
                          type="text"
                          placeholder="Etiqueta (ej: Gastos Médicos)"
                          value={benefit.label}
                          onChange={e => updateBenefit(idx, 'label', e.target.value)}
                          className="w-full p-2 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                      </div>
                      <div className="w-40">
                        <input
                          type="text"
                          placeholder="Valor (ej: US$ 250,000)"
                          value={benefit.value}
                          onChange={e => updateBenefit(idx, 'value', e.target.value)}
                          className="w-full p-2 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-2 pt-2">
                        <input
                          type="checkbox"
                          checked={benefit.isBold}
                          onChange={e => updateBenefit(idx, 'isBold', e.target.checked)}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-[10px] text-gray-500 font-bold">Negrita</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeBenefit(idx)}
                        className="p-2 text-gray-400 hover:text-red-600"
                      >
                        <MinusCircle className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  {(!editingLetter.benefits || editingLetter.benefits.length === 0) && (
                    <p className="text-center py-4 text-xs text-gray-400 italic bg-gray-50 rounded-xl border border-dashed border-gray-200">
                      No hay beneficios agregados a la tabla.
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Pie de Página / Notas</label>
                <textarea
                  rows={3}
                  value={editingLetter.footer}
                  onChange={e => setEditingLetter({ ...editingLetter, footer: e.target.value })}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                  placeholder="Información legal, deducibles, teléfonos de emergencia..."
                />
              </div>

              <div className="pt-6 flex gap-3 sticky bottom-0 bg-white pb-2">
                <button
                  type="button"
                  onClick={() => { setEditingLetter(null); setIsAdding(false); }}
                  className="flex-1 px-6 py-3 border border-gray-200 text-gray-700 font-bold rounded-xl hover:bg-gray-50 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className={`flex-2 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-100 flex items-center justify-center gap-2 transition-all ${saving ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {saving ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Save className="w-5 h-5" />
                  )}
                  {saving ? 'Guardando...' : 'Guardar Configuración'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
      />
    </div>
  );
}
