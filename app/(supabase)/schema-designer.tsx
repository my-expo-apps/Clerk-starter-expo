import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import * as Clipboard from 'expo-clipboard';
import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

type FieldType = 'uuid' | 'text' | 'int' | 'boolean' | 'timestamptz' | 'jsonb';

type Field = {
  name: string;
  type: FieldType;
  nullable: boolean;
};

type TableDraft = {
  name: string;
  fields: Field[];
};

function sanitizeIdent(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
}

function toSql(draft: TableDraft) {
  const table = sanitizeIdent(draft.name);
  const fields = draft.fields
    .filter((f) => f.name.trim())
    .map((f) => {
      const name = sanitizeIdent(f.name);
      const type = f.type;
      const nullable = f.nullable ? '' : ' not null';
      return `  ${name} ${type}${nullable}`;
    });

  const lines = [
    `create table if not exists public.${table} (`,
    `  id uuid primary key default gen_random_uuid(),`,
    ...fields.map((l) => `${l},`),
    `  created_at timestamptz not null default now(),`,
    `  updated_at timestamptz not null default now()`,
    `);`,
  ];

  return lines.join('\n');
}

export default function Page() {
  const [table, setTable] = React.useState<TableDraft>({
    name: 'my_table',
    fields: [
      { name: 'name', type: 'text', nullable: false },
      { name: 'meta', type: 'jsonb', nullable: true },
    ],
  });
  const [copied, setCopied] = React.useState<string | null>(null);

  const sql = React.useMemo(() => toSql(table), [table]);

  const copySql = async () => {
    await Clipboard.setStringAsync(sql);
    setCopied('SQL copied to clipboard');
    setTimeout(() => setCopied(null), 1500);
  };

  const addField = () => {
    setTable((t) => ({ ...t, fields: [...t.fields, { name: '', type: 'text', nullable: true }] }));
  };

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">Schema designer</ThemedText>
      <ThemedText type="subtitle">Draft a table and export SQL</ThemedText>

      <View style={styles.section}>
        <ThemedText style={styles.label}>Table name</ThemedText>
        <TextInput style={styles.input} value={table.name} onChangeText={(v) => setTable({ ...table, name: v })} />
      </View>

      <View style={styles.section}>
        <View style={styles.row}>
          <ThemedText style={styles.label}>Fields</ThemedText>
          <Pressable onPress={addField}>
            <ThemedText type="link">+ Add field</ThemedText>
          </Pressable>
        </View>

        {table.fields.map((f, idx) => (
          <View key={idx} style={styles.fieldRow}>
            <TextInput
              style={[styles.input, styles.fieldName]}
              value={f.name}
              placeholder="field_name"
              onChangeText={(v) =>
                setTable((t) => ({
                  ...t,
                  fields: t.fields.map((x, i) => (i === idx ? { ...x, name: v } : x)),
                }))
              }
            />
            <TextInput
              style={[styles.input, styles.fieldType]}
              value={f.type}
              onChangeText={(v) =>
                setTable((t) => ({
                  ...t,
                  fields: t.fields.map((x, i) => (i === idx ? { ...x, type: (v as FieldType) || 'text' } : x)),
                }))
              }
            />
            <Pressable
              onPress={() =>
                setTable((t) => ({
                  ...t,
                  fields: t.fields.map((x, i) => (i === idx ? { ...x, nullable: !x.nullable } : x)),
                }))
              }
              style={styles.nullableBtn}
            >
              <ThemedText style={styles.nullableText}>{f.nullable ? 'NULL' : 'NOT NULL'}</ThemedText>
            </Pressable>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <View style={styles.row}>
          <ThemedText style={styles.label}>Generated SQL</ThemedText>
          <Pressable onPress={copySql}>
            <ThemedText type="link">Copy</ThemedText>
          </Pressable>
        </View>

        <ScrollView style={styles.sqlBox}>
          <ThemedText style={styles.sqlText}>{sql}</ThemedText>
        </ScrollView>
        {copied ? <ThemedText style={styles.copied}>{copied}</ThemedText> : null}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    gap: 14,
  },
  section: {
    gap: 10,
  },
  label: {
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.15)',
    color: '#fff',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fieldRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  fieldName: { flex: 2 },
  fieldType: { flex: 1 },
  nullableBtn: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  nullableText: { fontWeight: '700' },
  sqlBox: {
    maxHeight: 220,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 12,
    padding: 12,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  sqlText: {
    fontFamily: 'SpaceMono',
    fontSize: 12,
    lineHeight: 18,
  },
  copied: {
    opacity: 0.9,
  },
});

