import { sql } from 'drizzle-orm';
import { db, pool } from '../db';

/*
 * Seed de produtos com DESCRIÇÕES ricas para testar a busca por descrição
 * no seletor de produtos (Pedido / Nota / Proposta / Contrato / Centro de custo).
 *
 * Cada produto tem termos que aparecem APENAS na descrição — assim, ao buscar
 * por esses termos na caixa de pesquisa do produto, o item deve aparecer mesmo
 * que a palavra não esteja no nome nem no SKU.
 *
 * Uso:  npm run seed:materials          (na pasta services/api-core)
 * Tenant: usa o do SEED_TAX_ID (padrão do seed) e, se não existir, o primeiro
 *         tenant cadastrado. Rode `npm run seed` antes se o banco estiver vazio.
 */

const TAX_ID = process.env.SEED_TAX_ID ?? '11444777000161';

interface MaterialSeed {
  sku:         string;
  name:        string;
  description: string;
  type:        'product' | 'service';
  category:    string;
  unit:        string;
  sale_price:  string;
  /** Termos que só existem na descrição — usados no resumo de teste. */
  hints:       string[];
}

const MATERIALS: MaterialSeed[] = [
  {
    sku: 'CAM-001', name: 'Camiseta', type: 'product', category: 'Vestuário', unit: 'UN', sale_price: '39.90',
    description: 'Malha 100% algodão penteado fio 30.1, gola careca, ideal para estampa DTF e silk.',
    hints: ['algodao', 'DTF', 'silk', 'gola careca'],
  },
  {
    sku: 'CAN-002', name: 'Caneca', type: 'product', category: 'Cozinha', unit: 'UN', sale_price: '24.90',
    description: 'Porcelana branca 325ml sublimável, alça em formato de coração disponível.',
    hints: ['porcelana', 'sublimavel', 'coracao', '325ml'],
  },
  {
    sku: 'BON-003', name: 'Boné', type: 'product', category: 'Acessórios', unit: 'UN', sale_price: '29.90',
    description: 'Aba curva, tecido brim com fechamento traseiro em velcro, bordado computadorizado.',
    hints: ['brim', 'velcro', 'bordado', 'aba curva'],
  },
  {
    sku: 'ALM-004', name: 'Almofada', type: 'product', category: 'Casa', unit: 'UN', sale_price: '34.90',
    description: 'Capa de neoprene 40x40 com enchimento de fibra siliconada antialérgica.',
    hints: ['neoprene', 'fibra siliconada', 'antialergica', '40x40'],
  },
  {
    sku: 'SQZ-005', name: 'Squeeze', type: 'product', category: 'Esporte', unit: 'UN', sale_price: '44.90',
    description: 'Garrafa de aço inox 500ml com parede dupla térmica, mantém gelado por 12h.',
    hints: ['inox', 'termica', 'parede dupla', '500ml'],
  },
  {
    sku: 'MOU-006', name: 'Mousepad', type: 'product', category: 'Escritório', unit: 'UN', sale_price: '19.90',
    description: 'Base antiderrapante de borracha emborrachada, superfície de tecido para sublimação.',
    hints: ['antiderrapante', 'borracha', 'sublimacao'],
  },
  {
    sku: 'CHA-007', name: 'Chaveiro', type: 'product', category: 'Brindes', unit: 'UN', sale_price: '9.90',
    description: 'Peça em MDF cru cortado a laser, acabamento para gravação personalizada.',
    hints: ['MDF', 'laser', 'gravacao'],
  },
  {
    sku: 'QUA-008', name: 'Quadro Decorativo', type: 'product', category: 'Casa', unit: 'UN', sale_price: '79.90',
    description: 'Moldura de MDF com impressão fine art em papel fosco e vidro antirreflexo.',
    hints: ['MDF', 'fine art', 'antirreflexo', 'fosco'],
  },
  {
    sku: 'ECO-009', name: 'Ecobag', type: 'product', category: 'Acessórios', unit: 'UN', sale_price: '27.90',
    description: 'Sacola sustentável de algodão cru reforçado, alças longas, estampa serigrafia.',
    hints: ['sustentavel', 'serigrafia', 'algodao cru', 'reforcado'],
  },
  {
    sku: 'AZU-010', name: 'Azulejo', type: 'product', category: 'Decoração', unit: 'UN', sale_price: '22.90',
    description: 'Cerâmica 15x15 esmaltada sublimável com suporte de cavalete incluso.',
    hints: ['ceramica', 'esmaltada', 'sublimavel', 'cavalete'],
  },
  {
    sku: 'COP-011', name: 'Copo Térmico', type: 'product', category: 'Cozinha', unit: 'UN', sale_price: '49.90',
    description: 'Copo de inox 473ml estilo americano com tampa de pressão e revestimento fosco.',
    hints: ['inox', 'americano', 'tampa de pressao', '473ml'],
  },
  {
    sku: 'CAD-012', name: 'Caderno', type: 'product', category: 'Papelaria', unit: 'UN', sale_price: '32.90',
    description: 'Capa dura em wire-o, miolo 90g pautado, 120 folhas, com elástico e marcador.',
    hints: ['wire-o', 'capa dura', 'pautado', 'elastico'],
  },
  // ── Peças de manutenção do compressor CPM 15 (componentes do kit abaixo) ──
  {
    sku: 'FIL-OLEO', name: 'Filtro de Óleo', type: 'product', category: 'Manutenção', unit: 'UN', sale_price: '85.00',
    description: 'Filtro de óleo para compressor parafuso CPM 15, elemento separador.',
    hints: ['filtro', 'oleo', 'CPM 15'],
  },
  {
    sku: 'FIL-AR', name: 'Filtro de Ar', type: 'product', category: 'Manutenção', unit: 'UN', sale_price: '120.00',
    description: 'Elemento filtrante de ar para compressor CPM 15, alta eficiência.',
    hints: ['filtro', 'ar', 'CPM 15'],
  },
  {
    sku: 'OLEO-15', name: 'Óleo Lubrificante 1L', type: 'product', category: 'Manutenção', unit: 'L', sale_price: '65.00',
    description: 'Óleo sintético para compressor parafuso, troca a cada 4.000 horas.',
    hints: ['oleo', 'sintetico', 'lubrificante', '4000 horas'],
  },
  {
    sku: 'MO-MANUT', name: 'Mão de Obra Técnica', type: 'service', category: 'Serviços', unit: 'H', sale_price: '90.00',
    description: 'Hora técnica de manutenção preventiva em compressor industrial.',
    hints: ['mao de obra', 'tecnica', 'preventiva'],
  },
  {
    sku: 'SRV-013', name: 'Aplicação de Estampa', type: 'service', category: 'Serviços', unit: 'UN', sale_price: '12.00',
    description: 'Mão de obra de prensa térmica para transfer DTF ou sublimação em peças do cliente.',
    hints: ['prensa termica', 'transfer', 'mao de obra', 'DTF'],
  },
  {
    sku: 'SRV-014', name: 'Arte Personalizada', type: 'service', category: 'Serviços', unit: 'UN', sale_price: '60.00',
    description: 'Criação de layout vetorial exclusivo no formato CDR/PDF pronto para impressão.',
    hints: ['vetorial', 'layout', 'CDR', 'exclusivo'],
  },
];

async function resolveTenant(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
  const byTaxId = await tx.execute<{ id: string; company_name: string }>(sql`
    SELECT id, company_name FROM tenants
    WHERE tax_id = ${TAX_ID} AND tax_id_type = 'CNPJ'
    ORDER BY created_at DESC
    LIMIT 1
  `);
  if (byTaxId.rows[0]) return byTaxId.rows[0];

  const fallback = await tx.execute<{ id: string; company_name: string }>(sql`
    SELECT id, company_name FROM tenants
    ORDER BY created_at ASC
    LIMIT 1
  `);
  return fallback.rows[0] ?? null;
}

async function seedMaterials() {
  try {
    const summary = await db.transaction(async (tx) => {
      const tenant = await resolveTenant(tx);
      if (!tenant) {
        throw new Error(
          'Nenhum tenant encontrado. Rode `npm run seed` antes para criar a empresa de demonstração.',
        );
      }

      for (const m of MATERIALS) {
        await tx.execute(sql`
          INSERT INTO materials
            (tenant_id, sku, name, description, type, category, unit, sale_price, is_active)
          VALUES
            (${tenant.id}, ${m.sku}, ${m.name}, ${m.description}, ${m.type},
             ${m.category}, ${m.unit}, ${m.sale_price}, true)
          ON CONFLICT (tenant_id, sku) DO UPDATE SET
            name        = EXCLUDED.name,
            description = EXCLUDED.description,
            type        = EXCLUDED.type,
            category    = EXCLUDED.category,
            unit        = EXCLUDED.unit,
            sale_price  = EXCLUDED.sale_price,
            is_active   = true
        `);
      }

      // ── Kit de exemplo: "Manutenção 4.000h CPM 15" ──────────────────────────
      const KIT_SKU = 'KIT-CPM15-4000';
      const KIT_PARTS = [
        { sku: 'FIL-OLEO', qty: 1 },
        { sku: 'FIL-AR',   qty: 1 },
        { sku: 'OLEO-15',  qty: 4 },
        { sku: 'MO-MANUT', qty: 4 },
      ];

      const { rows: [kit] } = await tx.execute<{ id: string }>(sql`
        INSERT INTO materials
          (tenant_id, sku, name, description, type, category, unit, sale_price, is_active, tracks_inventory)
        VALUES
          (${tenant.id}, ${KIT_SKU}, 'Manutenção 4.000h CPM 15',
           'Kit de manutenção preventiva de 4.000 horas do compressor CPM 15: filtros, óleo e mão de obra.',
           'kit', 'Manutenção', 'UN', '730.00', true, false)
        ON CONFLICT (tenant_id, sku) DO UPDATE SET
          name=EXCLUDED.name, description=EXCLUDED.description, type='kit',
          category=EXCLUDED.category, sale_price=EXCLUDED.sale_price, is_active=true, tracks_inventory=false
        RETURNING id
      `);

      await tx.execute(sql`DELETE FROM material_components WHERE kit_id = ${kit.id}`);
      let sort = 0;
      for (const p of KIT_PARTS) {
        const { rows: [comp] } = await tx.execute<{ id: string }>(sql`
          SELECT id FROM materials WHERE tenant_id = ${tenant.id} AND sku = ${p.sku} LIMIT 1
        `);
        if (!comp) continue;
        await tx.execute(sql`
          INSERT INTO material_components (tenant_id, kit_id, component_id, quantity, sort_order)
          VALUES (${tenant.id}, ${kit.id}, ${comp.id}, ${String(p.qty)}, ${sort++})
          ON CONFLICT (kit_id, component_id) DO UPDATE SET
            quantity = EXCLUDED.quantity, sort_order = EXCLUDED.sort_order
        `);
      }

      return { tenant, count: MATERIALS.length, kitParts: KIT_PARTS.length };
    });

    console.log('');
    console.log('✅  Seed de produtos concluído!');
    console.log(`🏢  Empresa  : ${summary.tenant.company_name}`);
    console.log(`🆔  Tenant ID: ${summary.tenant.id}`);
    console.log(`📦  Produtos : ${summary.count} inseridos/atualizados`);
    console.log(`🧰  Kit      : "Manutenção 4.000h CPM 15" (KIT-CPM15-4000) com ${summary.kitParts} peças`);
    console.log('');
    console.log('🧰  Teste o KIT: em Pedidos → Novo, busque "CPM 15" ou "manutenção" e escolha o kit.');
    console.log('    O sistema pergunta: Expandir nas peças OU Manter como 1 linha.');
    console.log('');
    console.log('🔎  Teste a busca POR DESCRIÇÃO digitando estes termos na caixa de pesquisa');
    console.log('    de produto (Pedido / Nota / Proposta) — eles NÃO estão no nome do item:');
    console.log('');
    for (const m of MATERIALS) {
      console.log(`    • ${m.name.padEnd(22)} → busque: ${m.hints.join(', ')}`);
    }
    console.log('');
    console.log('    Ex.: "sublimavel" acha Caneca, Azulejo… | "DTF" acha Camiseta + serviços |');
    console.log('         "inox" acha Squeeze e Copo | "MDF" acha Chaveiro e Quadro.');
    console.log('');
  } catch (err) {
    console.error('❌  Seed de produtos falhou:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

void seedMaterials();
