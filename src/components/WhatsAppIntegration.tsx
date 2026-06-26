import React, { useState, useEffect } from 'react';
import { 
  Send, Save, MessageSquare, Key, Phone, 
  HelpCircle, Info, Settings, CheckCircle, AlertCircle, Loader2
} from 'lucide-react';
import { 
  getWhatsAppSettings, 
  updateWhatsAppSettings, 
  triggerWhatsAppNotification,
  WhatsAppSettings 
} from '../services/whatsapp';

export default function WhatsAppIntegration() {
  const [settings, setSettings] = useState<WhatsAppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  
  // Test message state
  const [testPhone, setTestPhone] = useState('');
  const [testEvent, setTestEvent] = useState<'bienvenida' | 'estado_poliza' | 'recordatorio_pago' | 'renovacion'>('bienvenida');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    async function loadSettings() {
      try {
        const data = await getWhatsAppSettings();
        setSettings(data);
      } catch (err) {
        console.error("Error loading WhatsApp config:", err);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setSaveStatus('idle');
    try {
      await updateWhatsAppSettings(settings);
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err) {
      console.error("Error saving WhatsApp settings:", err);
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  };

  const handleTestSend = async () => {
    if (!settings || !testPhone.trim()) return;
    setTesting(true);
    setTestResult(null);

    // Mocked/sample insurance record to test personalizing and sending
    const sampleInsurance = {
      id: 'test-insurance-id',
      firstName: 'Juan',
      lastName: 'Pérez',
      plan: 'Traveler Plan 50K',
      status: 'paid',
      totalPrice: 1500,
      totalFinal: 1450,
      totalPaid: 1450,
      endDate: '2026-12-31',
      phone: testPhone.trim(),
      email: 'juan.perez@example.com'
    };

    try {
      const result = await triggerWhatsAppNotification(testEvent, sampleInsurance);
      setTestResult({
        success: result.success,
        message: result.success 
          ? "¡Mensaje enviado con éxito! Revisa tu celular." 
          : `Error al enviar: ${result.message}`
      });
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || "Error desconocido al procesar el envío."
      });
    } finally {
      setTesting(false);
    }
  };

  const updateTemplateField = (field: string, value: any) => {
    if (!settings) return;
    setSettings({
      ...settings,
      templates: {
        ...settings.templates,
        [field]: value
      }
    });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-500">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
        <p className="font-bold">Cargando Configuración de WhatsApp...</p>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="p-6 bg-red-50 text-red-700 rounded-2xl flex items-center gap-3">
        <AlertCircle className="w-6 h-6" />
        <p className="font-bold">Ocurrió un error al cargar la configuración de WhatsApp settings.</p>
      </div>
    );
  }

  return (
    <div id="whatsapp-integration-container" className="space-y-8 animate-in fade-in duration-300">
      
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-r from-emerald-50 to-teal-50 p-6 rounded-2xl border border-emerald-100">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <MessageSquare className="w-6 h-6 text-emerald-600" />
            Integración de WhatsApp Business Cloud API
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Conecta la API oficial de Meta para automatizar alertas y notificaciones a tus asegurados.
          </p>
        </div>
        <div className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-full font-bold uppercase tracking-wider">
          Meta Certificado
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left 2 Columns: Credentials & Templates Form */}
        <form onSubmit={handleSave} className="lg:col-span-2 space-y-8">
          
          {/* Credentials Section */}
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-6">
            <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
              <Key className="w-4 h-4 text-gray-500" />
              Credenciales de la API de Meta
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase mb-2 flex items-center gap-1">
                  Identificador de Teléfono (Phone ID)
                  <span title="Se obtiene desde el panel de desarrolladores de Meta (Meta for Developers).">
                    <HelpCircle className="w-3 h-3 text-gray-300 pointer-events-auto" />
                  </span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: 105151523456789"
                  value={settings.phoneId}
                  onChange={e => setSettings({ ...settings, phoneId: e.target.value })}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-900 text-sm"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase mb-2 flex items-center gap-1">
                  ID de la Cuenta Comercial (Business Account ID)
                  <span title="El ID de Administrador Comercial de WhatsApp asociado.">
                    <HelpCircle className="w-3 h-3 text-gray-300 pointer-events-auto" />
                  </span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: 304252512345678"
                  value={settings.businessAccountId}
                  onChange={e => setSettings({ ...settings, businessAccountId: e.target.value })}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-900 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase mb-2 flex items-center gap-1">
                Token de Acceso Permanente (System User Access Token)
                <span title="Token de acceso generado en Meta Business Manager con permisos whatsapp_business_messaging.">
                  <HelpCircle className="w-3 h-3 text-gray-300 pointer-events-auto" />
                </span>
              </label>
              <textarea
                required
                rows={3}
                placeholder="Escribe o pega tu token permanente EAA..."
                value={settings.accessToken}
                onChange={e => setSettings({ ...settings, accessToken: e.target.value })}
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-medium text-gray-800 text-xs font-mono"
              />
            </div>
          </div>

          {/* Templates Editor Section */}
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-6">
            <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-emerald-600" />
              Plantillas de Mensaje Automatizadas
            </h3>
            <p className="text-xs text-gray-500 leading-relaxed">
              Define los mensajes que se enviarán automáticamente a través de la API. Recuerda que para iniciar conversaciones, Meta exige que registres y apruebes estas plantillas en su portal de WhatsApp Cloud API. El sistema enviará el texto personalizado tal como se define aquí.
            </p>

            {/* Quick Toggle Dashboard */}
            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-2">
                  <Settings className="w-4 h-4 text-slate-500 animate-spin-slow" />
                  Activación Rápida de Eventos de Notificación
                </h4>
                <span className="text-[10px] bg-slate-200 text-slate-700 font-bold px-2 py-0.5 rounded-full uppercase">
                  Interruptores Maestros
                </span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Event 1: Bienvenida */}
                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between hover:border-emerald-200 transition-all">
                  <div className="space-y-1 pr-3">
                    <p className="text-sm font-bold text-gray-800 flex items-center gap-2">
                      <span className="flex h-2 w-2 relative">
                        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${settings.templates.bienvenidaActive ? 'bg-emerald-400' : 'bg-gray-400'}`}></span>
                        <span className={`relative inline-flex rounded-full h-2 w-2 ${settings.templates.bienvenidaActive ? 'bg-emerald-500' : 'bg-gray-300'}`}></span>
                      </span>
                      1. Bienvenida
                    </p>
                    <p className="text-[11px] text-gray-500 leading-normal">
                      Se envía al crear o dar de alta al cliente en la plataforma.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateTemplateField('bienvenidaActive', !settings.templates.bienvenidaActive)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      settings.templates.bienvenidaActive ? 'bg-emerald-500' : 'bg-gray-200'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        settings.templates.bienvenidaActive ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Event 2: Estado de Póliza */}
                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between hover:border-blue-200 transition-all">
                  <div className="space-y-1 pr-3">
                    <p className="text-sm font-bold text-gray-800 flex items-center gap-2">
                      <span className="flex h-2 w-2 relative">
                        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${settings.templates.estadoActive ? 'bg-blue-400' : 'bg-gray-400'}`}></span>
                        <span className={`relative inline-flex rounded-full h-2 w-2 ${settings.templates.estadoActive ? 'bg-blue-500' : 'bg-gray-300'}`}></span>
                      </span>
                      2. Estado de Póliza
                    </p>
                    <p className="text-[11px] text-gray-500 leading-normal">
                      Se despacha automáticamente al actualizar el estatus de emisión de la póliza.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateTemplateField('estadoActive', !settings.templates.estadoActive)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      settings.templates.estadoActive ? 'bg-emerald-500' : 'bg-gray-200'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        settings.templates.estadoActive ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Event 3: Recordatorio de Pago */}
                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between hover:border-yellow-200 transition-all">
                  <div className="space-y-1 pr-3">
                    <p className="text-sm font-bold text-gray-800 flex items-center gap-2">
                      <span className="flex h-2 w-2 relative">
                        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${settings.templates.recordatorioActive ? 'bg-yellow-400' : 'bg-gray-400'}`}></span>
                        <span className={`relative inline-flex rounded-full h-2 w-2 ${settings.templates.recordatorioActive ? 'bg-yellow-500' : 'bg-gray-300'}`}></span>
                      </span>
                      3. Recordatorio de Pago
                    </p>
                    <p className="text-[11px] text-gray-500 leading-normal">
                      Notificaciones de cuentas por cobrar o proximidad de vencimiento de cuotas.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateTemplateField('recordatorioActive', !settings.templates.recordatorioActive)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      settings.templates.recordatorioActive ? 'bg-emerald-500' : 'bg-gray-200'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        settings.templates.recordatorioActive ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Event 4: Renovación */}
                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between hover:border-purple-200 transition-all">
                  <div className="space-y-1 pr-3">
                    <p className="text-sm font-bold text-gray-800 flex items-center gap-2">
                      <span className="flex h-2 w-2 relative">
                        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${settings.templates.renovacionActive ? 'bg-purple-400' : 'bg-gray-400'}`}></span>
                        <span className={`relative inline-flex rounded-full h-2 w-2 ${settings.templates.renovacionActive ? 'bg-purple-500' : 'bg-gray-300'}`}></span>
                      </span>
                      4. Renovación
                    </p>
                    <p className="text-[11px] text-gray-500 leading-normal">
                      Avisos automáticos de vigencia de cobertura próxima a expirar.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateTemplateField('renovacionActive', !settings.templates.renovacionActive)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      settings.templates.renovacionActive ? 'bg-emerald-500' : 'bg-gray-200'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        settings.templates.renovacionActive ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>

            {/* Template 1: Bienvenida */}
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                  <p className="text-xs font-black text-gray-700 uppercase tracking-wider">1. Plantilla de Bienvenida</p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.templates.bienvenidaActive}
                    onChange={e => updateTemplateField('bienvenidaActive', e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-[10px] font-bold text-gray-500 uppercase">Activo</span>
                </label>
              </div>
              <textarea
                rows={3}
                value={settings.templates.bienvenidaBody}
                onChange={e => updateTemplateField('bienvenidaBody', e.target.value)}
                className="w-full p-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm text-gray-800"
                placeholder="Escribe el mensaje de bienvenida..."
              />
            </div>

            {/* Template 2: Estado de Póliza */}
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                  <p className="text-xs font-black text-gray-700 uppercase tracking-wider">2. Estado de Póliza / Emisión</p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.templates.estadoActive}
                    onChange={e => updateTemplateField('estadoActive', e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-[10px] font-bold text-gray-500 uppercase">Activo</span>
                </label>
              </div>
              <textarea
                rows={3}
                value={settings.templates.estadoBody}
                onChange={e => updateTemplateField('estadoBody', e.target.value)}
                className="w-full p-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm text-gray-800"
                placeholder="Escribe el mensaje de actualización de estado..."
              />
            </div>

            {/* Template 3: Recordatorio de Pago */}
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-yellow-500"></span>
                  <p className="text-xs font-black text-gray-700 uppercase tracking-wider">3. Recordatorio de Pago</p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.templates.recordatorioActive}
                    onChange={e => updateTemplateField('recordatorioActive', e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-[10px] font-bold text-gray-500 uppercase">Activo</span>
                </label>
              </div>
              <textarea
                rows={3}
                value={settings.templates.recordatorioBody}
                onChange={e => updateTemplateField('recordatorioBody', e.target.value)}
                className="w-full p-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm text-gray-800"
                placeholder="Escribe el recordatorio de pago..."
              />
            </div>

            {/* Template 4: Renovación */}
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-500"></span>
                  <p className="text-xs font-black text-gray-700 uppercase tracking-wider">4. Renovación</p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.templates.renovacionActive}
                    onChange={e => updateTemplateField('renovacionActive', e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-[10px] font-bold text-gray-500 uppercase">Activo</span>
                </label>
              </div>
              <textarea
                rows={3}
                value={settings.templates.renovacionBody}
                onChange={e => updateTemplateField('renovacionBody', e.target.value)}
                className="w-full p-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm text-gray-800"
                placeholder="Escribe el aviso de renovación..."
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 max-w-xs px-6 py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 disabled:bg-emerald-300 shadow-lg shadow-emerald-100 transition-all flex items-center justify-center gap-2"
            >
              {saving ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Save className="w-5 h-5" />
              )}
              {saving ? 'Guardando...' : 'Guardar Configuración'}
            </button>

            {saveStatus === 'success' && (
              <div className="flex items-center gap-1.5 text-emerald-600 text-xs font-bold animate-in slide-in-from-left-2">
                <CheckCircle className="w-4 h-4" />
                Configuración guardada correctamente
              </div>
            )}
            {saveStatus === 'error' && (
              <div className="flex items-center gap-1.5 text-red-600 text-xs font-bold animate-in slide-in-from-left-2">
                <AlertCircle className="w-4 h-4" />
                Error al guardar configuración
              </div>
            )}
          </div>
        </form>

        {/* Right 1 Column: Helpers, Placeholders & Sandbox Test Panel */}
        <div className="space-y-8">
          
          {/* Dynamic Placeholders Helper */}
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
            <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
              <Info className="w-4 h-4 text-emerald-600" />
              Variables Dinámicas
            </h3>
            <p className="text-xs text-gray-500 leading-relaxed">
              Copia y pega estas etiquetas en tus plantillas. El sistema las reemplazará automáticamente con la información real de la póliza y del asegurado.
            </p>

            <div className="space-y-3">
              <div className="flex justify-between items-center bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                <code className="text-xs font-mono font-bold text-blue-600">{"{nombre}"}</code>
                <span className="text-[10px] font-bold text-gray-500">Nombre completo del asegurado</span>
              </div>
              <div className="flex justify-between items-center bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                <code className="text-xs font-mono font-bold text-blue-600">{"{plan}"}</code>
                <span className="text-[10px] font-bold text-gray-500">Nombre del Plan</span>
              </div>
              <div className="flex justify-between items-center bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                <code className="text-xs font-mono font-bold text-blue-600">{"{estado}"}</code>
                <span className="text-[10px] font-bold text-gray-500">Estado de póliza (Pagada, Reconciliada, etc.)</span>
              </div>
              <div className="flex justify-between items-center bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                <code className="text-xs font-mono font-bold text-blue-600">{"{monto}"}</code>
                <span className="text-[10px] font-bold text-gray-500">Precio Total (Venta)</span>
              </div>
              <div className="flex justify-between items-center bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                <code className="text-xs font-mono font-bold text-blue-600">{"{pagado}"}</code>
                <span className="text-[10px] font-bold text-gray-500">Saldo pagado total</span>
              </div>
              <div className="flex justify-between items-center bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                <code className="text-xs font-mono font-bold text-blue-600">{"{fecha_vencimiento}"}</code>
                <span className="text-[10px] font-bold text-gray-500">Fin de la vigencia</span>
              </div>
            </div>
          </div>

          {/* Sandbox Testing Console */}
          <div className="bg-slate-900 text-white p-6 rounded-2xl border border-slate-800 shadow-xl space-y-6">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-emerald-500/10 rounded-lg">
                <Phone className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-300">Banco de Pruebas (Test Sandbox)</h3>
                <p className="text-[10px] text-slate-400">Prueba tu conexión enviando un mensaje inmediato.</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Teléfono de Destinatario</label>
                <input
                  type="text"
                  placeholder="Ej: +528181850121"
                  value={testPhone}
                  onChange={e => setTestPhone(e.target.value)}
                  className="w-full p-3 bg-slate-800 border border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-white text-sm font-bold font-mono placeholder:text-slate-500"
                />
              </div>

              <div>
                <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Tipo de Evento</label>
                <select
                  value={testEvent}
                  onChange={e => setTestEvent(e.target.value as any)}
                  className="w-full p-3 bg-slate-800 border border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-slate-300 text-xs font-bold"
                >
                  <option value="bienvenida">1. Bienvenida</option>
                  <option value="estado_poliza">2. Estado de Póliza</option>
                  <option value="recordatorio_pago">3. Recordatorio de Pago</option>
                  <option value="renovacion">4. Renovación</option>
                </select>
              </div>

              <button
                type="button"
                onClick={handleTestSend}
                disabled={testing || !testPhone.trim()}
                className="w-full py-3 bg-emerald-500 text-slate-950 font-black rounded-xl hover:bg-emerald-400 transition-colors disabled:bg-slate-800 disabled:text-slate-500 text-xs uppercase tracking-wider flex items-center justify-center gap-2"
              >
                {testing ? (
                  <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                {testing ? "Enviando..." : "Enviar Mensaje de Prueba"}
              </button>

              {testResult && (
                <div className={`p-4 rounded-xl border text-xs flex gap-2 ${
                  testResult.success 
                    ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/50' 
                    : 'bg-red-950/40 text-red-300 border-red-800/50'
                }`}>
                  {testResult.success ? (
                    <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
                  )}
                  <p className="font-medium">{testResult.message}</p>
                </div>
              )}
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
