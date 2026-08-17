import type { ApiRule, RuleDecision } from '@tada/shared'
import { useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useCreateRule, useDeleteRule, usePatchRule, useRules } from '../../api/queries'
import { useTheme } from '../../design/ThemeContext'
import { space, type } from '../../design/tokens'
import { holdingTag, parsePatterns, ruleDetailLine, ruleProvenanceTag } from '../../settingsScreen'
import { Button, Checkbox, Dialog, Input, Menu, Sheet, ListRow, Tag } from '../ui'
import { type Segment, SegmentedPill } from './SegmentedPill'
import { SettingsRow, SettingsSection } from './SettingsSection'

const DECISIONS: Segment<RuleDecision>[] = [
  { value: 'allow', label: 'Allow' },
  { value: 'ask', label: 'Ask', tone: 'live' },
  { value: 'never', label: 'Never', tone: 'fail' },
]

/**
 * The permission rule table — what gates check before every tool call. First match wins; the
 * pull request is the default gate. "Always allow" at a hold edits this same table (rows it
 * wrote carry a "set from a gate" tag) and logs it in Today.
 */
export function RulesCard() {
  const { colors } = useTheme()
  const { data: rules } = useRules()
  const patchRule = usePatchRule()
  const deleteRule = useDeleteRule()
  const createRule = useCreateRule()

  const [menuFor, setMenuFor] = useState<ApiRule | null>(null)
  const [toDelete, setToDelete] = useState<ApiRule | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [title, setTitle] = useState('')
  const [tool, setTool] = useState('Bash')
  const [patterns, setPatterns] = useState('')
  const [decision, setDecision] = useState<RuleDecision>('ask')
  const [publishes, setPublishes] = useState(false)
  const [addError, setAddError] = useState('')

  const closeAdd = () => {
    setShowAdd(false)
    setTitle('')
    setTool('Bash')
    setPatterns('')
    setDecision('ask')
    setPublishes(false)
    setAddError('')
  }

  const handleAdd = () => {
    setAddError('')
    if (!title.trim()) return setAddError('Give the rule a name')
    createRule.mutate(
      { title: title.trim(), tool: tool.trim() || 'Bash', patterns: parsePatterns(patterns), decision, publishes },
      { onSuccess: closeAdd, onError: () => setAddError('Could not add the rule') },
    )
  }

  const list = rules ?? []

  const intro = (
    <Text style={[type.caption, styles.intro, { color: colors.textMuted }]}>
      What halts a run mid-step. The default makes the pull request the one review moment:{' '}
      <Text style={[type.caption, { color: colors.text, fontWeight: '600' }]}>pushes run — a pushed branch is inert — publishing asks.</Text>{' '}
      First match wins. Always allow at a gate edits this same table and logs it in Today.
    </Text>
  )

  return (
    <SettingsSection title="Permission rules" intro={intro} testID="settings-rules">
      {list.length === 0 ? (
        <SettingsRow>
          <Text style={[type.caption, { color: colors.textFaintSolid }]}>No rules — every tool call runs without asking.</Text>
        </SettingsRow>
      ) : null}
      {list.map((rule) => {
        const holding = holdingTag(rule)
        const provenance = ruleProvenanceTag(rule)
        return (
          <SettingsRow key={rule.id} testID={`rule-${rule.id}`}>
            <Pressable
              style={styles.ruleText}
              accessibilityLabel={`${rule.title} options`}
              onLongPress={() => setMenuFor(rule)}
              {...(Platform.OS === 'web'
                ? {
                    onContextMenu: (e: { preventDefault: () => void }) => {
                      e.preventDefault()
                      setMenuFor(rule)
                    },
                  }
                : {})}
            >
              <View style={styles.titleRow}>
                <Text style={[type.caption, styles.ruleTitle, { color: colors.text }]}>{rule.title}</Text>
                {holding ? <Tag label={holding} testID={`rule-${rule.id}-holding`} /> : null}
                {provenance ? <Tag label={provenance} testID={`rule-${rule.id}-provenance`} /> : null}
              </View>
              {ruleDetailLine(rule) ? (
                <Text style={[type.monoSmall, { color: colors.textFaintSolid }]} numberOfLines={2}>
                  {ruleDetailLine(rule)}
                </Text>
              ) : null}
            </Pressable>
            <SegmentedPill<RuleDecision>
              testID={`rule-${rule.id}-decision`}
              value={rule.decision}
              segments={DECISIONS}
              onChange={(next) => patchRule.mutate({ id: rule.id, patch: { decision: next } })}
            />
          </SettingsRow>
        )
      })}
      <SettingsRow last>
        <Button testID="open-add-rule" variant="secondary" small label="Add a rule" onPress={() => setShowAdd(true)} />
        <View style={styles.flex1} />
        <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>gated calls in one step are asked once</Text>
      </SettingsRow>

      {Platform.OS === 'web' ? (
        <Menu visible={menuFor !== null} onClose={() => setMenuFor(null)} testID="rule-menu">
          <ListRow
            testID="rule-delete"
            title="Delete rule"
            destructive
            onPress={() => {
              setToDelete(menuFor)
              setMenuFor(null)
            }}
          />
        </Menu>
      ) : (
        <Sheet visible={menuFor !== null} onClose={() => setMenuFor(null)} testID="rule-sheet">
          <ListRow
            testID="rule-delete"
            title="Delete rule"
            destructive
            onPress={() => {
              setToDelete(menuFor)
              setMenuFor(null)
            }}
          />
        </Sheet>
      )}

      <Dialog
        visible={toDelete !== null}
        title="Delete rule?"
        onClose={() => setToDelete(null)}
        confirm={{
          label: 'Delete',
          destructive: true,
          testID: 'rule-delete-confirm',
          onPress: () => {
            const rule = toDelete
            setToDelete(null)
            if (rule) deleteRule.mutate(rule.id)
          },
        }}
      >
        <Text style={[type.body, { color: colors.textMuted }]}>
          {`"${toDelete?.title ?? ''}" is removed from the table. Calls it matched will run without asking unless another rule catches them.`}
        </Text>
      </Dialog>

      <Dialog
        visible={showAdd}
        title="Add a rule"
        onClose={closeAdd}
        testID="add-rule-dialog"
        confirm={{ label: 'Add rule', onPress: handleAdd, loading: createRule.isPending, testID: 'add-rule-confirm' }}
      >
        <View style={styles.form}>
          <Input testID="rule-title-input" label="Name" placeholder="Run a database migration" value={title} onChangeText={setTitle} />
          <Input testID="rule-tool-input" label="Tool" mono placeholder="Bash" autoCapitalize="none" value={tool} onChangeText={setTool} />
          <Input
            testID="rule-patterns-input"
            label="Patterns — one per line, * matches anything"
            mono
            multiline
            autoCapitalize="none"
            placeholder="*pnpm db:migrate*"
            value={patterns}
            onChangeText={setPatterns}
          />
          <View style={styles.decisionRow}>
            <Text style={[type.caption, { color: colors.text }]}>Decision</Text>
            <SegmentedPill<RuleDecision> testID="rule-decision-new" value={decision} segments={DECISIONS} onChange={setDecision} />
          </View>
          <Checkbox testID="rule-publishes" label="Publishes — code leaves your box (shows the diff at the gate)" checked={publishes} onChange={setPublishes} />
          {addError ? (
            <Text testID="add-rule-error" accessibilityRole="alert" style={[type.caption, { color: colors.failText }]}>
              {addError}
            </Text>
          ) : null}
        </View>
      </Dialog>
    </SettingsSection>
  )
}

const styles = StyleSheet.create({
  intro: { marginTop: -space.xs },
  ruleText: { flex: 1, minWidth: 180, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  ruleTitle: { fontWeight: '500', fontSize: 13.5 },
  flex1: { flex: 1 },
  form: { gap: space.md },
  decisionRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
})
