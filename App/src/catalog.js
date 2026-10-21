// Catálogos compartidos: tipos de visita, mediciones, refrigerantes y checklists

const VISIT_TYPES = {
  reparacion:     { label: 'Reparación',            color: '#eb6834' },
  mantencion:     { label: 'Mantención preventiva', color: '#2a78d6' },
  rutinaria:      { label: 'Visita rutinaria',      color: '#1baf7a' },
  implementacion: { label: 'Implementación',        color: '#eda100' },
};

const RESULTS = {
  operativo:      'Operativo',
  operativo_obs:  'Operativo con observaciones',
  fuera_servicio: 'Fuera de servicio',
  pendiente:      'Pendiente (requiere nueva visita)',
};

const EQUIPMENT_KINDS = {
  camara_conservacion: 'Cámara de conservación',
  camara_congelado: 'Cámara de congelado',
  tunel: 'Túnel de congelado',
  chiller: 'Chiller',
  rack: 'Rack de compresores',
  vitrina: 'Vitrina / mueble refrigerado',
  split: 'Equipo split / unidad condensadora',
  otro: 'Otro',
};

// Mediciones en terreno. group sirve para ordenar el formulario.
const MEASUREMENTS = {
  temp_interior:      { label: 'Temperatura interior (cámara/equipo)', unit: '°C',  group: 'Ambiente controlado' },
  hr_interior:        { label: 'Humedad relativa interior',            unit: '%',   group: 'Ambiente controlado' },
  temp_producto:      { label: 'Temperatura de producto',              unit: '°C',  group: 'Ambiente controlado' },
  temp_retorno_aire:  { label: 'Aire retorno evaporador',              unit: '°C',  group: 'Evaporador' },
  temp_inyeccion_aire:{ label: 'Aire inyección evaporador',            unit: '°C',  group: 'Evaporador' },
  vel_aire_evap:      { label: 'Velocidad de aire evaporador',         unit: 'm/s', group: 'Flujo de aire' },
  vel_aire_cond:      { label: 'Velocidad de aire condensador',        unit: 'm/s', group: 'Flujo de aire' },
  presion_baja:       { label: 'Presión de succión (baja)',            unit: 'bar', group: 'Circuito frigorífico' },
  presion_alta:       { label: 'Presión de descarga (alta)',           unit: 'bar', group: 'Circuito frigorífico' },
  temp_sat_evap:      { label: 'T° saturación evaporación',            unit: '°C',  group: 'Circuito frigorífico' },
  temp_sat_cond:      { label: 'T° saturación condensación',           unit: '°C',  group: 'Circuito frigorífico' },
  temp_succion:       { label: 'T° línea de succión',                  unit: '°C',  group: 'Circuito frigorífico' },
  temp_liquido:       { label: 'T° línea de líquido',                  unit: '°C',  group: 'Circuito frigorífico' },
  temp_descarga:      { label: 'T° de descarga compresor',             unit: '°C',  group: 'Circuito frigorífico' },
  temp_sala_maquinas: { label: 'T° sala de máquinas / condensador',    unit: '°C',  group: 'Entorno' },
  hr_sala_maquinas:   { label: 'Humedad sala de máquinas',             unit: '%',   group: 'Entorno' },
  corriente:          { label: 'Corriente compresor',                  unit: 'A',   group: 'Eléctrico' },
  voltaje:            { label: 'Voltaje',                              unit: 'V',   group: 'Eléctrico' },
};

// Potencial de calentamiento global (GWP, IPCC AR4 — el usado en reportes F-Gas / Kigali)
const REFRIGERANTS = {
  R404A: 3922, R507A: 3985, R134a: 1430, R410A: 2088, R407C: 1774, R22: 1810,
  R448A: 1387, R449A: 1397, R513A: 631, R32: 675, R290: 3, R600a: 3, R744: 1, R717: 0, R1234yf: 4,
};

// Checklist sugerido según el tipo de visita
const CHECKLISTS = {
  mantencion: [
    'Limpieza de serpentín condensador',
    'Limpieza de serpentín evaporador y bandeja de drenaje',
    'Revisión de ventiladores (ruido, vibración, aspas)',
    'Revisión de deshielos (resistencias / ciclos)',
    'Verificación de presiones de trabajo',
    'Prueba de fugas (detector electrónico)',
    'Revisión de nivel de aceite compresor',
    'Reapriete de conexiones eléctricas',
    'Revisión de contactores y protecciones',
    'Verificación de controlador y sensores',
    'Revisión de burletes y cierre de puertas',
    'Revisión de aislación de cañerías',
  ],
  rutinaria: [
    'Temperatura dentro de rango',
    'Registro de alarmas del controlador',
    'Estado de puertas y cortinas',
    'Formación de hielo en evaporador',
    'Ruidos o vibraciones anormales',
    'Drenaje sin obstrucciones',
  ],
  reparacion: [
    'Falla reproducida / verificada',
    'Equipo bloqueado y señalizado (LOTO)',
    'Componente defectuoso identificado',
    'Prueba de fugas posterior a intervención',
    'Vacío y carga según especificación',
    'Prueba de funcionamiento final',
    'Temperatura recuperada',
  ],
  implementacion: [
    'Montaje de equipos según plano',
    'Prueba de hermeticidad con nitrógeno',
    'Vacío (< 500 micrones)',
    'Carga de refrigerante registrada',
    'Conexionado eléctrico y protecciones',
    'Programación de controlador',
    'Puesta en marcha y ajuste',
    'Capacitación al usuario',
    'Entrega de documentación',
  ],
};

// Qué fotos pide el informe según el motivo
const PHOTO_GUIDE = {
  reparacion: ['Falla encontrada (antes)', 'Componente reemplazado', 'Equipo funcionando (después)', 'Placa del equipo'],
  mantencion: ['Condensador antes', 'Condensador después', 'Evaporador', 'Tablero eléctrico'],
  rutinaria: ['Display / controlador', 'Interior de cámara'],
  implementacion: ['Instalación terminada', 'Unidad condensadora', 'Evaporadores', 'Tablero', 'Placa de datos'],
};

module.exports = { VISIT_TYPES, RESULTS, EQUIPMENT_KINDS, MEASUREMENTS, REFRIGERANTS, CHECKLISTS, PHOTO_GUIDE };
