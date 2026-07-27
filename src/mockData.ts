/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Customer,
  Inquiry,
  SalesOrder,
  ProductionPlan,
  LogbookTemplate,
  MachineLogbook,
  QualityInspection,
  PackingRecord,
  InventoryTransaction,
  DispatchRecord,
  CustomerComplaint,
  CAPARecord,
  Machine,
  Supplier,
  BatchLineage
} from './types';

export const initialCustomers: Customer[] = [
  {
    id: 'cust-1',
    name: 'Apex Plastic Industries',
    gstNumber: '27AAAAA1111A1Z1',
    contactPerson: 'Rahul Sharma',
    phone: '+91 98765 43210',
    email: 'rahul@apexplastics.com',
    billingAddress: 'Plot 42, GIDC Industrial Estate, Vapi, Gujarat, 396191',
    deliveryAddress: 'Plot 42, GIDC Industrial Estate, Vapi, Gujarat, 396191',
    paymentTerms: '30 Days Net',
    status: 'active'
  },
  {
    id: 'cust-2',
    name: 'Sterling Cables & Polymers',
    gstNumber: '27BBBBB2222B2Z2',
    contactPerson: 'Amit Patel',
    phone: '+91 91234 56789',
    email: 'purchasing@sterlingcables.in',
    billingAddress: 'Sector 5, IMT Manesar, Gurugram, Haryana, 122051',
    deliveryAddress: 'Warehouse B, Sector 8, IMT Manesar, Gurugram, 122051',
    paymentTerms: '45 Days Net',
    status: 'active'
  },
  {
    id: 'cust-3',
    name: 'Evershine Profiles Ltd',
    gstNumber: '27CCCCC3333C3Z3',
    contactPerson: 'Sanjay Jain',
    phone: '+91 99887 76655',
    email: 'sanjay.jain@evershine.co',
    billingAddress: 'A-12, MIDC Bhosari, Pune, Maharashtra, 411026',
    deliveryAddress: 'A-12, MIDC Bhosari, Pune, Maharashtra, 411026',
    paymentTerms: 'Advance Payment',
    status: 'active'
  },
  {
    id: 'cust-4',
    name: 'Delta Auto Components',
    gstNumber: '27DDDDD4444D4Z4',
    contactPerson: 'Vikram Singh',
    phone: '+91 98989 89898',
    email: 'v.singh@deltaauto.com',
    billingAddress: 'Oragadam Industrial Area, Chennai, Tamil Nadu, 600032',
    deliveryAddress: 'Oragadam Industrial Area, Chennai, Tamil Nadu, 600032',
    paymentTerms: '15 Days Net',
    status: 'inactive'
  }
];

export const initialInquiries: Inquiry[] = [
  {
    id: 'inq-1',
    inquiryNumber: 'INQ-2026-001',
    customerId: 'cust-1',
    product: 'LD Beads Black - 12mm',
    drawingRef: 'DRG-LD-12B.pdf',
    quantity: 5000,
    expectedDeliveryDate: '2026-08-01',
    remarks: 'High gloss finish required for cosmetic trim.',
    status: 'quotation',
    quotationPrice: 165.50
  },
  {
    id: 'inq-2',
    inquiryNumber: 'INQ-2026-002',
    customerId: 'cust-2',
    product: 'SPVC Sheathing Grade - Type A',
    drawingRef: 'SPEC-SPVC-SHEATH.pdf',
    quantity: 12000,
    expectedDeliveryDate: '2026-08-15',
    remarks: 'Needs strictly fire-retardant properties as per standard.',
    status: 'approved',
    quotationPrice: 142.00
  },
  {
    id: 'inq-3',
    inquiryNumber: 'INQ-2026-003',
    customerId: 'cust-3',
    product: 'RPVC Window Gasket Grey',
    drawingRef: 'DRG-RPVC-WG-09.pdf',
    quantity: 8000,
    expectedDeliveryDate: '2026-07-28',
    remarks: 'Fitment test sample must be approved before continuous extrusion.',
    status: 'draft'
  }
];

export const initialSalesOrders: SalesOrder[] = [
  {
    id: 'so-1',
    soNumber: 'SO-2026-101',
    inquiryId: 'inq-1',
    customerId: 'cust-1',
    product: 'LD Beads Black - 12mm',
    quantity: 5000,
    deliveryDate: '2026-08-01',
    priority: 'high',
    specialInstructions: 'Ensure absolute zero line-mark defects. Pack in 25kg bags, double shrink-wrap.',
    status: 'planned'
  },
  {
    id: 'so-2',
    soNumber: 'SO-2026-102',
    inquiryId: 'inq-2',
    customerId: 'cust-2',
    product: 'SPVC Sheathing Grade - Type A',
    quantity: 12000,
    deliveryDate: '2026-08-15',
    priority: 'medium',
    specialInstructions: 'Certificate of Analysis (COA) for FR parameters required with consignment.',
    status: 'pending'
  },
  {
    id: 'so-3', soNumber: 'SO-2026-103', inquiryId: 'inq-3', customerId: 'cust-3',
    product: 'RPVC Window Gasket Grey', quantity: 8000, deliveryDate: '2026-07-30',
    priority: 'high', specialInstructions: 'First article approval before continuous run.', status: 'pending'
  },
  {
    id: 'so-4', soNumber: 'SO-2026-104', inquiryId: 'inq-1', customerId: 'cust-1',
    product: 'LD Beads Black - 12mm', quantity: 6000, deliveryDate: '2026-08-05',
    priority: 'medium', specialInstructions: 'Double shrink-wrap, 25kg bags.', status: 'pending'
  },
  {
    id: 'so-5', soNumber: 'SO-2026-105', inquiryId: 'inq-2', customerId: 'cust-2',
    product: '007 SM RPVC010.C 11MM White', quantity: 4000, deliveryDate: '2026-07-28',
    priority: 'high', specialInstructions: 'Needs CaCO3 lots — check store availability.', status: 'pending'
  }
];

export const initialProductionPlans: ProductionPlan[] = [
  {
    id: 'plan-1',
    salesOrderId: 'so-1',
    machineId: 'M04',
    shift: 'D',
    operatorName: 'Ramesh Sawant',
    scheduledStartDate: '2026-07-14T08:00:00',
    scheduledEndDate: '2026-07-14T16:00:00',
    status: 'scheduled'
  }
];

export const initialLogbookTemplates: LogbookTemplate[] = [
  {
    id: 'tmpl-spvc042',
    docNo: 'QR/MFG/013',
    revNo: '02',
    revDate: '14-07-2025',
    brandName: 'MASS POLYMERS',
    location: 'BENGALURU',
    title: 'MACHINE LOG BOOK',
    productName: '090 SM SPVC042 Z 150M 7.8K M/V Black (Revised-1)',
    shifts: ['D', 'N'],
    supervisors: ['Nandlal', 'Pankaj', 'Nitesh', 'Suresh Kumar', 'Ravi Shankar'],
    lotNumberNote: 'Refer to QR/Store/022',
    dieZones: ['Die 6', 'Die 5'],
    barrelZones: ['Zone 4', 'Zone 3', 'Zone 2', 'Zone 1'],
    zoneSpecs: {
      'Die 6': { target: 135, min: 130, max: 140 },
      'Die 5': { target: 135, min: 130, max: 140 },
      'Zone 4': { target: 132, min: 125, max: 140 },
      'Zone 3': { target: 128, min: 120, max: 135 },
      'Zone 2': { target: 128, min: 120, max: 135 },
      'Zone 1': { target: 122, min: 115, max: 130 }
    },
    coil: { perM: 150, targetKg: 7.8, bobbinGms: 140, rangeLo: 7.945, rangeHi: 7.995, count: 44 },
    inspectionTimeSlots: ['9–10', '12–1', '3–4', '6–7', '8–9'],
    dimensionSpecs: {
      top: { label: 'Top Dim', nominal: 13.4, tol: 0.2, lo: 13.2, hi: 13.6 },
      bottom: { label: 'Bottom Dim', nominal: 13, tol: 0.2, lo: 12.8, hi: 13.2 },
      thickness: { label: 'Thickness', count: 3, lo: 0.9, hi: 1.1 }
    },
    finishSpec: 'Matt',
    perMeterSpec: '52 gms',
    traceability: { tableCount: 2, rowsPerTable: 15 },
    rejectionReasons: [
      'Finishing Issue', 'Coil Weight Issue', 'Cut Mark Issue', 'Roughness Issue',
      'Line Mark Issue', 'Bubble Issue', 'Others'
    ],
    notes: [
      'Visually performed 100% By Operator',
      'DVC – Digital Vernier Caliper, MM – Micro Meter, WS – Weighing scale, DHG – Digital Height gauge, HT – Hardness Tester and All Dimensions are in MM'
    ],
    layout: 'coil', hardnessType: 'A', productionUnit: 'roll', packingNote: 'Packing 2 Rolls'
  },
  {
    // Format A — Pipe / "Nos" (rigid PVC), from QR/MFG/013 Rev 03 (007 RPVC010.C).
    id: 'tmpl-rpvc010',
    docNo: 'QR/MFG/013',
    revNo: '03',
    revDate: '18-07-2026',
    brandName: 'MASS POLYMERS',
    location: 'BENGALURU',
    title: 'MACHINE LOG BOOK',
    productName: '007 SM RPVC010.C 11MM 1180MM 178G N/V White T.D',
    shifts: ['D', 'N'],
    supervisors: ['Ashish', 'Pankaj', 'Behlu', 'Nitesh', 'Santosh'],
    lotNumberNote: 'Refer to QR/Store/022',
    dieZones: ['Die 6', 'Die 5'],
    barrelZones: ['Zone 4', 'Zone 3', 'Zone 2', 'Zone 1'],
    zoneSpecs: {
      'Die 6': { target: 185, min: 180, max: 190 },
      'Die 5': { target: 186, min: 180, max: 190 },
      'Zone 4': { target: 0, min: 0, max: 0 },
      'Zone 3': { target: 195, min: 185, max: 200 },
      'Zone 2': { target: 175, min: 168, max: 182 },
      'Zone 1': { target: 165, min: 158, max: 172 }
    },
    coil: { perM: 0, targetKg: 0, bobbinGms: 0, rangeLo: 0, rangeHi: 0, count: 0 },
    inspectionTimeSlots: ['9–10', '12–1', '3–4', '6–7', '8–9'],
    dimensionSpecs: {
      top: { label: '', nominal: 0, tol: 0, lo: 0, hi: 0 },
      bottom: { label: '', nominal: 0, tol: 0, lo: 0, hi: 0 },
      thickness: { label: '', count: 0, lo: 0, hi: 0 }
    },
    finishSpec: '',
    perMeterSpec: '',
    traceability: { tableCount: 1, rowsPerTable: 14 },
    rejectionReasons: [
      'Finishing Issue', 'Weight Issue', 'Profile / Length Size Issue',
      'Cutting Issue', 'Line Mark Issue', 'Other'
    ],
    notes: [
      'Visually performed 100% By Operator',
      'DVC – Digital Vernier Caliper, MM – Micro Meter, WS – Weighing scale, DHG – Digital Height gauge, HT – Hardness Tester and All Dimensions are in MM'
    ],
    layout: 'pipe', hardnessType: 'D', productionUnit: 'nos', packingNote: 'Packing 200 Nos',
    pipeSpecs: {
      od: { label: 'OD', nominal: 11, tol: 0.2, lo: 10.8, hi: 11.3 },
      weight: { label: 'Weight', nominal: 178, lo: 176, hi: 178 },
      length: { lo: 1180, hi: 1185 },
      dieSizerGap: '23 inch'
    }
  }
];

export const initialMachineLogbooks: MachineLogbook[] = [
  {
    id: 'log-101',
    productionPlanId: 'plan-1',
    templateId: 'tmpl-spvc042',
    status: 'submitted',
    rolls: [],
    scrapKg: '',
    operatorSignature: '',
    supervisorSignature: '',
    // id row
    machineId: 'M09',
    date: '01/07/26',
    shift: 'N',
    supervisor: 'Nandlal',
    // §1 process parameters
    drawingNo: 'SPVC008D',
    tag: 'Blue',
    formulaNo: '5F13',
    dieZoneTemps: { 'Die 6': '', 'Die 5': '134' },
    barrelZoneTemps: { 'Zone 4': '132', 'Zone 3': '139', 'Zone 2': '132', 'Zone 1': '128' },
    motorSpeed: '26.20',
    ampere: '15.0',
    takeupSpeed: '15.65',
    vacuum: '',
    extruderStartTime: '9:00',
    productSetTime: '9:00',
    shoreHardness: '85',
    productionPerHour: '25 Kg',
    moldNo: 'SPVC042.F',
    productName: '090 SM SPVC042 Z 150M 7.8K M/V Black (Revised-1)',
    // §2 inspection report
    coilWeights: Array.from({ length: 44 }, () => ''),
    hourlyInspections: ['9–10', '12–1', '3–4', '6–7', '8–9'].map((timeSlot) => ({
      timeSlot,
      topDim: '',
      bottomDim: '',
      thickness: ['', '', ''],
      finish: '',
      perMeter: '',
      colour: '',
      tearing: '',
      inspectionBy: ''
    })),
    // §3 traceability (packing rolls)
    traceabilityRows: Array.from({ length: 30 }, (_, i) => {
      const idx = i + 1;
      if (idx <= 8) {
        return {
          lotNumber: `010726·N·M09·B${String(idx).padStart(2, '0')}`,
          colour: 'BLK',
          code: 'BK0137',
          winderPackedBy: 'Nandlal',
          qcStatus: 'pending' as const
        };
      }
      return { lotNumber: '', colour: '', code: '', winderPackedBy: '' };
    }),
    // §4 production report
    totalRollsProduced: '37',
    totalRollKgs: '288.6',
    processWasteKg: '',
    lumpsWasteKg: '',
    rejectionKg: '2',
    totalConsumedKg: '291.6 Kg',
    rejectionCounts: {
      'Finishing Issue': '2',
      'Coil Weight Issue': '',
      'Cut Mark Issue': '',
      'Roughness Issue': '',
      'Line Mark Issue': '',
      'Bubble Issue': '',
      'Others': ''
    },
    meterCheckedBy: 'Nandlal',
    meterCheckTime: '3:00',
    meter: '154/M',
    meterCountSet: '314'
  }
];

export const initialQualityInspections: QualityInspection[] = [
  {
    id: 'insp-1',
    rollNumber: 'R-LD-12B-001',
    lotNumber: 'LOT-LD-260713-01',
    dimensions: {
      'Outer Diameter (mm)': '12.02',
      'Inner Diameter (mm)': '8.01',
      'Wall Thickness (mm)': '2.01'
    },
    finish: 'pass',
    weight: 25.4,
    colour: 'pass',
    tearingTest: 'pass',
    remarks: 'Excellent surface gloss and structural strength. Uniform thickness.',
    decision: 'pass',
    inspectedBy: 'John Carter (QA)',
    date: '2026-07-13'
  },
  {
    id: 'insp-2',
    rollNumber: 'R-LD-12B-002',
    lotNumber: 'LOT-LD-260713-01',
    dimensions: {
      'Outer Diameter (mm)': '12.05',
      'Inner Diameter (mm)': '7.98',
      'Wall Thickness (mm)': '2.035'
    },
    finish: 'pass',
    weight: 25.1,
    colour: 'pass',
    tearingTest: 'pass',
    remarks: 'Minor line marks, within acceptable spec. Pass.',
    decision: 'pass',
    inspectedBy: 'John Carter (QA)',
    date: '2026-07-13'
  },
  {
    id: 'insp-3',
    rollNumber: 'R-LD-12B-003',
    lotNumber: 'LOT-LD-260713-01',
    dimensions: {
      'Outer Diameter (mm)': '12.11',
      'Inner Diameter (mm)': '7.94',
      'Wall Thickness (mm)': '2.085'
    },
    finish: 'fail',
    weight: 24.8,
    colour: 'pass',
    tearingTest: 'pass',
    remarks: 'Heavy line mark defects and outer diameter exceeds tolerance of 12.10mm.',
    decision: 'fail',
    inspectedBy: 'John Carter (QA)',
    date: '2026-07-13'
  }
];

export const initialPackingRecords: PackingRecord[] = [
  {
    id: 'pack-1',
    rollNumber: 'R-LD-12B-001',
    weight: 25.4,
    palletNumber: 'PLT-0713-04',
    packingDate: '2026-07-13',
    packedBy: 'P. Kamble',
    labelGenerated: true,
    qrCode: 'MPERP::R-LD-12B-001::WT:25.4::LOT:LOT-LD-260713-01'
  },
  {
    id: 'pack-2',
    rollNumber: 'R-LD-12B-002',
    weight: 25.1,
    palletNumber: 'PLT-0713-04',
    packingDate: '2026-07-13',
    packedBy: 'P. Kamble',
    labelGenerated: true,
    qrCode: 'MPERP::R-LD-12B-002::WT:25.1::LOT:LOT-LD-260713-01'
  }
];

export const initialInventoryTransactions: InventoryTransaction[] = [
  // Raw materials
  {
    id: 'inv-1',
    type: 'raw_material',
    direction: 'in',
    itemCode: 'RM-LDPE-H2410',
    itemName: 'LDPE Virgin Resin Grade H2410',
    quantity: 15000,
    unit: 'Kgs',
    lotNumber: 'LOT-RM-LDPE-904',
    reference: 'PO-2026-4402',
    date: '2026-07-10',
    handler: 'Madan Gopal (Store)'
  },
  {
    id: 'inv-2',
    type: 'raw_material',
    direction: 'out',
    itemCode: 'RM-LDPE-H2410',
    itemName: 'LDPE Virgin Resin Grade H2410',
    quantity: 800,
    unit: 'Kgs',
    lotNumber: 'LOT-RM-LDPE-904',
    reference: 'REQ-MFG-Extruder01',
    date: '2026-07-13',
    handler: 'Madan Gopal (Store)'
  },
  {
    id: 'inv-3',
    type: 'raw_material',
    direction: 'in',
    itemCode: 'RM-SPVC-K67',
    itemName: 'Suspended PVC Resin K67',
    quantity: 25000,
    unit: 'Kgs',
    lotNumber: 'LOT-RM-SPVC-1102',
    reference: 'PO-2026-4403',
    date: '2026-07-12',
    handler: 'Madan Gopal (Store)'
  },
  // Finished Goods
  {
    id: 'inv-4',
    type: 'finished_goods',
    direction: 'in',
    itemCode: 'FG-LD-12B',
    itemName: 'LD Beads Black - 12mm',
    quantity: 50.5, // 2 rolls passed weight
    unit: 'Kgs',
    lotNumber: 'LOT-LD-260713-01',
    reference: 'LOG-101',
    date: '2026-07-13',
    handler: 'Madan Gopal (Store)'
  }
];

export const initialDispatchRecords: DispatchRecord[] = [
  {
    id: 'disp-1',
    invoiceNumber: 'INV-2026-809',
    salesOrderId: 'so-1',
    vehicleNumber: 'MH-04-GP-8839',
    transporter: 'Om Sai Logistics',
    driverName: 'Suraj Patil',
    dispatchDate: '2026-07-13',
    deliveryAddress: 'Plot 42, GIDC Industrial Estate, Vapi, Gujarat, 396191',
    etaDate: '2026-07-14',
    status: 'shipped',
    communicationTriggered: true
  }
];

export const initialCustomerComplaints: CustomerComplaint[] = [
  {
    id: 'comp-1',
    complaintNumber: 'COMP-2026-01',
    customerId: 'cust-1',
    batchNumber: 'LOT-LD-250622-04',
    product: 'LD Beads Black - 12mm',
    description: 'Received 1 roll out of 20 with severe line mark defects across a 15-meter stretch. Impedes cosmetic appearance.',
    photoUrl: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=500&auto=format&fit=crop&q=60',
    severity: 'medium',
    status: 'investigating',
    date: '2026-07-01'
  },
  {
    id: 'comp-104',
    complaintNumber: 'C-104',
    customerId: 'cust-2',
    batchNumber: '180726·N·M08·B03',
    product: '007 SM RPVC010.C 11MM 1180MM White',
    description: 'Pin holes and weight variation on reprocess-blend rolls. Traced to a reprocess LDPE lot accepted without a trial result.',
    severity: 'high',
    status: 'investigating',
    date: '2026-07-21'
  }
];

export const initialCapaRecords: CAPARecord[] = [
  {
    id: 'capa-1',
    complaintId: 'comp-1',
    rootCause: 'Die lip build-up of plastic material degraded and formed abrasive protrusions, causing line marks during high-temperature extrusion.',
    correctiveAction: 'Stopped the extruder, thoroughly cleaned the die lip with brass scraper tools, and adjusted the air-ring cooling.',
    preventiveAction: 'Updated the preventative maintenance schedule to require automated die-lip inspections and polishing every 48 operating hours instead of weekly.',
    responsiblePerson: 'Kailash Nath (Shift Supervisor)',
    dueDate: '2026-07-20',
    status: 'in_progress'
  }
];

/* ------------------------------------------------------------------ *
 * Click-dummy data spine (SPEC_ERP_CLICKDUMMY.md)
 * ------------------------------------------------------------------ */

export const initialMachines: Machine[] = [
  { id: 'M01', line: 'LDPE / co-extrusion coil', family: 'LDPE', logbookFormat: 'QR/MFG/012', status: 'running', currentProduct: 'LD coil 40µ clear', currentFormula: 'RF03' },
  { id: 'M02', line: 'LDPE coil', family: 'LDPE', logbookFormat: 'QR/MFG/012', status: 'running', currentProduct: 'LD coil 50µ natural' },
  { id: 'M03', line: 'LDPE coil', family: 'LDPE', logbookFormat: 'QR/MFG/012', status: 'attention', statusReason: 'Zone 3 near upper limit — 178 °C', currentProduct: 'LD coil 60µ white' },
  { id: 'M04', line: 'LDPE coil', family: 'LDPE', logbookFormat: 'QR/MFG/012', status: 'running', currentProduct: 'LD Beads Black 12mm', currentFormula: 'RF03', currentLot: '200726·D·M04·B05' },
  { id: 'M05', line: 'LDPE coil', family: 'LDPE', logbookFormat: 'QR/MFG/012', status: 'stopped', statusReason: 'Power failure — maintenance notified' },
  { id: 'M06', line: 'PVC / SPVC profile', family: 'PVC', logbookFormat: 'QR/MFG/013', status: 'running', currentProduct: 'PVC beading 8mm white' },
  { id: 'M07', line: 'PVC profile', family: 'PVC', logbookFormat: 'QR/MFG/013', status: 'running', currentProduct: 'PVC profile grey' },
  { id: 'M08', line: 'PVC / SPVC beading', family: 'PVC', logbookFormat: 'QR/MFG/013', status: 'running', currentProduct: '007 SM RPVC010.C 11MM 1180MM 178G N/V White T.D', currentFormula: 'RF03', currentLot: '190726·D·M08·B01' },
  { id: 'M09', line: 'PVC / SPVC beading', family: 'PVC', logbookFormat: 'QR/MFG/013', status: 'running', currentProduct: '090 SM SPVC042 Z 150M 7.8K M/V Black', currentFormula: 'SF13', currentLot: '010726·N·M09·B17' }
];

export const initialSuppliers: Supplier[] = [
  { id: 'sup-1', name: 'Sri Venkatesh Polymers', material: 'RPVC resin', acceptRatePct: 98 },
  { id: 'sup-2', name: 'Deccan Granules', material: 'LDPE granules', acceptRatePct: 96 },
  { id: 'sup-3', name: 'Kaveri Minerals', material: 'CaCO3 filler', acceptRatePct: 99 },
  { id: 'sup-4', name: 'Ashirwad Additives', material: 'Stabilizer', acceptRatePct: 97 },
  { id: 'sup-5', name: 'Deccan Reprocessors', material: 'Reprocess LDPE', isReprocess: true, acceptRatePct: 82 }
];

export const initialBatchLineages: BatchLineage[] = [
  {
    id: 'lin-clean',
    lot: '190726·D·M08·B01',
    headline: '007 SM RPVC010.C 11MM 1180MM 178G N/V White T.D',
    machineId: 'M08',
    outcome: 'clean',
    aliases: ['R-M08-1901', 'PLT-1907-11', 'INV-2026-811', '190726·D·M08·B02'],
    siblings: ['190726·D·M08·B02'],
    steps: [
      { stage: 'supplier', title: 'Supplier resin lot received', when: '16 Jul 2026', by: 'Sri Venkatesh Polymers', status: 'info', fields: [{ label: 'Material', value: 'RPVC resin' }, { label: 'Supplier lot', value: 'SVP·RPVC·2607·14', mono: true }, { label: 'Quantity', value: '15,000 kg' }] },
      { stage: 'incoming', title: 'Incoming inspection — accepted', docFormat: 'QR/STORE/022', when: '16 Jul 2026', by: 'Store — Ravi Shankar', status: 'pass', fields: [{ label: 'Verdict', value: 'Accepted' }, { label: 'Moisture', value: '0.18 %' }, { label: 'Trial result', value: 'Passed' }] },
      { stage: 'store_issue', title: 'Store issue to Machine 08', docFormat: 'QR/STORE/022', when: '19 Jul 2026 · 07:40', by: 'Store — Ravi Shankar', status: 'info', fields: [{ label: 'Issued to', value: 'M08' }, { label: 'Quantity', value: '800 kg' }] },
      { stage: 'formulation', title: 'Formulation RF03 mixed', when: '19 Jul 2026 · 08:10', by: 'Operator — Nandlal', status: 'pass', fields: [{ label: 'Formula', value: 'RF03' }, { label: 'Batch', value: '190726·D·M08·B01', mono: true }] },
      { stage: 'production', title: 'Production shift — Day, Machine 08', docFormat: 'QR/MFG/013', when: '19 Jul 2026 · Day', by: 'Operator — Nandlal', status: 'pass', fields: [{ label: 'Rolls produced', value: '37 rolls · 288.6 kg' }, { label: 'Lot', value: '190726·D·M08·B01', mono: true }] },
      { stage: 'qa', title: 'Quality inspection — all rolls passed', docFormat: 'QR/MFG/013', when: '19 Jul 2026', by: 'Quality — Nitesh', status: 'pass', fields: [{ label: 'Rolls checked', value: '37 of 37' }, { label: 'Result', value: 'All passed' }, { label: 'Coil weight', value: 'within 7.945–7.995 kg' }] },
      { stage: 'pallet', title: 'Palletised for warehouse', when: '19 Jul 2026', by: 'Store — Suresh Kumar', status: 'info', fields: [{ label: 'Pallet', value: 'PLT-1907-11', mono: true }, { label: 'Rolls', value: '37' }] },
      { stage: 'dispatch', title: 'Dispatched to customer', docFormat: 'QR/DES/031', when: '20 Jul 2026', by: 'Dispatch — Pankaj', status: 'pass', fields: [{ label: 'Invoice', value: 'INV-2026-811', mono: true }, { label: 'Vehicle', value: 'KA-01-AB-4412' }, { label: 'Customer', value: 'Apex Plastic Industries' }] }
    ]
  },
  {
    id: 'lin-fail',
    lot: '180726·N·M08·B03',
    headline: '007 SM RPVC010.C (reprocess blend)',
    machineId: 'M08',
    outcome: 'complaint',
    aliases: ['R-M08-1803-07', 'PLT-1807-09', 'INV-2026-806', 'C-104', 'RG-1807-01'],
    siblings: ['180726·N·M08·B01', '180726·N·M08·B02'],
    steps: [
      { stage: 'supplier', title: 'Reprocess LDPE lot received', when: '17 Jul 2026', by: 'Deccan Reprocessors', status: 'info', fields: [{ label: 'Material', value: 'Reprocess LDPE' }, { label: 'Supplier lot', value: 'DRP·LDPE·1707·03', mono: true }, { label: 'Quantity', value: '5,000 kg' }] },
      { stage: 'incoming', title: 'Incoming inspection — accepted without trial', docFormat: 'QR/STORE/022', when: '17 Jul 2026', by: 'Store — Ravi Shankar', status: 'hold', flag: 'Accepted without a trial result — reprocess material should be trial-run before use.', fields: [{ label: 'Verdict', value: 'Accepted (no trial)' }, { label: 'Trial result', value: 'Missing' }] },
      { stage: 'store_issue', title: 'Store issue to Machine 08', docFormat: 'QR/STORE/022', when: '18 Jul 2026 · 21:30', by: 'Store — Ravi Shankar', status: 'info', fields: [{ label: 'Issued to', value: 'M08' }, { label: 'Quantity', value: '600 kg' }] },
      { stage: 'production', title: 'Production shift — Night, Machine 08', docFormat: 'QR/MFG/013', when: '18 Jul 2026 · Night', by: 'Operator — Suresh Kumar', status: 'info', fields: [{ label: 'Rolls produced', value: '24 rolls' }, { label: 'Lot', value: '180726·N·M08·B03', mono: true }] },
      { stage: 'qa', title: 'Quality inspection — 1 roll failed on weight', docFormat: 'QR/MFG/013', when: '18 Jul 2026', by: 'Quality — Nitesh', status: 'fail', fields: [{ label: 'Failed roll', value: 'R-M08-1803-07', mono: true }, { label: 'Reason', value: 'Weight issue — coil out of range' }, { label: 'Others', value: '23 rolls passed' }] },
      { stage: 'regrind', title: 'Regrind lot created from failed roll', when: '18 Jul 2026', by: 'Quality — Nitesh', status: 'info', fields: [{ label: 'Regrind lot', value: 'RG-1807-01', mono: true }, { label: 'Parent roll', value: 'R-M08-1803-07', mono: true }] },
      { stage: 'dispatch', title: 'Remaining rolls dispatched', docFormat: 'QR/DES/031', when: '19 Jul 2026', by: 'Dispatch — Pankaj', status: 'pass', fields: [{ label: 'Invoice', value: 'INV-2026-806', mono: true }, { label: 'Vehicle', value: 'KA-05-CJ-8890' }, { label: 'Customer', value: 'Sterling Cables & Polymers' }] },
      { stage: 'complaint', title: 'Customer complaint — pin holes / weight variation', docFormat: 'QR/CRM/041', when: '21 Jul 2026', by: 'Sales — Amit', status: 'fail', flag: 'Severity High — answer within 3 days.', fields: [{ label: 'Complaint', value: 'C-104', mono: true }, { label: 'Against invoice', value: 'INV-2026-806', mono: true }, { label: 'Issue', value: 'Pin holes and weight variation' }, { label: 'Respond by', value: '24 Jul 2026' }] }
    ]
  }
];
