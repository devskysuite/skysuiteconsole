import React, { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
    doc,
    getDoc,
    serverTimestamp,
    Timestamp,
    updateDoc,
} from "firebase/firestore";
import { db } from "../../firebase";

type ToolDoc = {
    toolId?: string;
    name?: string;
    status?: "IN_SHOP" | "CHECKED_OUT" | "DAMAGED" | string;

    checkedOutToEmployeeName?: string;
    checkedOutToJobName?: string;
    checkedOutAt?: any;
    dueBackAt?: any;

    damagedNote?: string;
    damagedReportedBy?: string;
    damagedReportedAt?: any;
};

function fmt(ts: any) {
    if (!ts?.toDate) return "—";
    return ts.toDate().toLocaleDateString("en-US", { month: "long", day: "2-digit" });
}

function dateOnly(d: Date) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function fmtDateOnly(d: Date | null) {
    if (!d) return "Select date";
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export default function ToolDetailsScreen() {
    const { toolId } = useLocalSearchParams<{ toolId: string }>();
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [tool, setTool] = useState<ToolDoc | null>(null);
    const [saving, setSaving] = useState(false);

    // Checkout fields
    const [employee, setEmployee] = useState("");
    const [job, setJob] = useState("");
    const [dueDate, setDueDate] = useState<Date | null>(null);
    const [tempDueDate, setTempDueDate] = useState<Date>(dateOnly(new Date()));
    const [showPicker, setShowPicker] = useState(false);

    // Extend due date fields
    const [extendDate, setExtendDate] = useState<Date | null>(null);
    const [tempExtendDate, setTempExtendDate] = useState<Date>(dateOnly(new Date()));
    const [showExtendPicker, setShowExtendPicker] = useState(false);

    // Damage report fields
    const [showDamageForm, setShowDamageForm] = useState(false);
    const [damageNote, setDamageNote] = useState("");
    const [damageReporter, setDamageReporter] = useState("");

    async function load() {
        try {
            setLoading(true);
            const id = (toolId || "").trim();
            if (!id) { setTool(null); return; }

            const ref = doc(db, "tools", id);
            const snap = await getDoc(ref);

            if (!snap.exists()) { setTool(null); return; }

            const data = snap.data() as ToolDoc;
            setTool(data);

            if (data.checkedOutToEmployeeName) setEmployee(data.checkedOutToEmployeeName);
            if (data.checkedOutToJobName) setJob(data.checkedOutToJobName);

            if (data.dueBackAt?.toDate) {
                const d = dateOnly(data.dueBackAt.toDate());
                setDueDate(d);
                setTempDueDate(d);
            } else {
                setTempDueDate(dateOnly(new Date()));
            }
        } catch (e: any) {
            Alert.alert("Error", e?.message ?? "Failed to load tool");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [toolId]);

    const status = tool?.status || "UNKNOWN";
    const isCheckedOut = status === "CHECKED_OUT";
    const isDamaged = status === "DAMAGED";
    const isOverdue = isCheckedOut && tool?.dueBackAt?.toDate && tool.dueBackAt.toDate() < new Date();

    function dueDateToTimestamp(d: Date) {
        const due = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 17, 0, 0);
        return Timestamp.fromDate(due);
    }

    async function checkout() {
        const id = (toolId || "").trim();
        if (!id) return;
        const emp = employee.trim();
        const jb = job.trim();
        if (!emp || !jb || !dueDate) {
            Alert.alert("Missing info", "Enter Employee, Job, and choose a Due Back date.");
            return;
        }
        try {
            setSaving(true);
            await updateDoc(doc(db, "tools", id), {
                status: "CHECKED_OUT",
                checkedOutToEmployeeName: emp,
                checkedOutToJobName: jb,
                checkedOutAt: serverTimestamp(),
                dueBackAt: dueDateToTimestamp(dueDate),
            });
            Alert.alert("Checked out", `${id} checked out to ${emp}.`);
            await load();
        } catch (e: any) {
            Alert.alert("Error", e?.message ?? "Failed to check out tool");
        } finally {
            setSaving(false);
        }
    }

    async function returnTool() {
        const id = (toolId || "").trim();
        if (!id) return;
        Alert.alert("Return tool?", `Mark ${id} as returned to the shop?`, [
            { text: "Cancel", style: "cancel" },
            {
                text: "Return",
                style: "destructive",
                onPress: async () => {
                    try {
                        setSaving(true);
                        await updateDoc(doc(db, "tools", id), {
                            status: "IN_SHOP",
                            checkedOutToEmployeeName: "",
                            checkedOutToJobName: "",
                            checkedOutAt: null,
                            dueBackAt: null,
                            overdueNotifiedAt: null,
                        });
                        Alert.alert("Returned", `${id} returned to the shop.`);
                        await load();
                    } catch (e: any) {
                        Alert.alert("Error", e?.message ?? "Failed to return tool");
                    } finally {
                        setSaving(false);
                    }
                },
            },
        ]);
    }

    async function extendDueDate() {
        const id = (toolId || "").trim();
        if (!id) return;
        if (!extendDate) {
            Alert.alert("Missing date", "Choose a new due back date.");
            return;
        }
        try {
            setSaving(true);
            await updateDoc(doc(db, "tools", id), {
                dueBackAt: dueDateToTimestamp(extendDate),
                overdueNotifiedAt: null,
            });
            Alert.alert("Extended", `Due date updated to ${fmtDateOnly(extendDate)}.`);
            setExtendDate(null);
            setShowExtendPicker(false);
            await load();
        } catch (e: any) {
            Alert.alert("Error", e?.message ?? "Failed to extend due date");
        } finally {
            setSaving(false);
        }
    }

    async function reportDamage() {
        const id = (toolId || "").trim();
        if (!id) return;
        const note = damageNote.trim();
        const reporter = damageReporter.trim();
        if (!note || !reporter) {
            Alert.alert("Missing info", "Enter your name and describe the damage.");
            return;
        }
        try {
            setSaving(true);
            await updateDoc(doc(db, "tools", id), {
                status: "DAMAGED",
                damagedNote: note,
                damagedReportedBy: reporter,
                damagedReportedAt: serverTimestamp(),
                damagedPhotoUrl: "",
                // Clear check-out info if it was checked out
                checkedOutToEmployeeName: "",
                checkedOutToJobName: "",
                checkedOutAt: null,
                dueBackAt: null,
                overdueNotifiedAt: null,
            });
            Alert.alert("Damage reported", "The tool has been marked as damaged.");
            setDamageNote("");
            setDamageReporter("");
            setShowDamageForm(false);
            await load();
        } catch (e: any) {
            Alert.alert("Error", e?.message ?? "Failed to report damage");
        } finally {
            setSaving(false);
        }
    }

    async function markRepaired() {
        const id = (toolId || "").trim();
        if (!id) return;
        Alert.alert("Mark as repaired?", "This will set the tool back to In Shop.", [
            { text: "Cancel", style: "cancel" },
            {
                text: "Mark Repaired",
                onPress: async () => {
                    try {
                        setSaving(true);
                        await updateDoc(doc(db, "tools", id), {
                            status: "IN_SHOP",
                            damagedNote: "",
                            damagedReportedBy: "",
                            damagedReportedAt: null,
                            damagedPhotoUrl: "",
                        });
                        Alert.alert("Repaired", `${id} is back in service.`);
                        await load();
                    } catch (e: any) {
                        Alert.alert("Error", e?.message ?? "Failed to mark as repaired");
                    } finally {
                        setSaving(false);
                    }
                },
            },
        ]);
    }

    // ---- Checkout picker handlers ----
    function openDatePicker() {
        setTempDueDate(dueDate ?? dateOnly(new Date()));
        setShowPicker(true);
    }

    function onPickerChange(event: any, selected?: Date) {
        if (Platform.OS === "android") {
            if (event?.type === "dismissed") { setShowPicker(false); return; }
            const next = selected ?? new Date(event?.nativeEvent?.timestamp);
            setShowPicker(false);
            if (next && !isNaN(next.getTime())) {
                const d = dateOnly(next);
                setDueDate(d);
                setTempDueDate(d);
            }
            return;
        }
        const ts = event?.nativeEvent?.timestamp;
        const next = selected ?? (typeof ts === "number" ? new Date(ts) : undefined);
        if (!next || isNaN(next.getTime())) return;
        setTempDueDate(dateOnly(next));
    }

    function confirmIOSDate() { setDueDate(dateOnly(tempDueDate)); setShowPicker(false); }
    function cancelIOSDate() { setTempDueDate(dueDate ?? dateOnly(new Date())); setShowPicker(false); }

    // ---- Extend picker handlers ----
    function openExtendPicker() {
        setTempExtendDate(extendDate ?? dateOnly(new Date()));
        setShowExtendPicker(true);
    }

    function onExtendPickerChange(event: any, selected?: Date) {
        if (Platform.OS === "android") {
            if (event?.type === "dismissed") { setShowExtendPicker(false); return; }
            const next = selected ?? new Date(event?.nativeEvent?.timestamp);
            setShowExtendPicker(false);
            if (next && !isNaN(next.getTime())) {
                const d = dateOnly(next);
                setExtendDate(d);
                setTempExtendDate(d);
            }
            return;
        }
        const ts = event?.nativeEvent?.timestamp;
        const next = selected ?? (typeof ts === "number" ? new Date(ts) : undefined);
        if (!next || isNaN(next.getTime())) return;
        setTempExtendDate(dateOnly(next));
    }

    function confirmIOSExtendDate() { setExtendDate(dateOnly(tempExtendDate)); setShowExtendPicker(false); }
    function cancelIOSExtendDate() { setTempExtendDate(extendDate ?? dateOnly(new Date())); setShowExtendPicker(false); }

    return (
        <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
        >
        <ScrollView
            style={styles.container}
            contentContainerStyle={styles.contentContainer}
            keyboardShouldPersistTaps="handled"
        >
            <Stack.Screen options={{ headerShown: false }} />

            <View style={styles.headerRow}>
                <TouchableOpacity style={styles.backPill} onPress={() => router.back()}>
                    <Text style={styles.backText}>Back</Text>
                </TouchableOpacity>
                <View style={styles.headerTitlePill}>
                    <Text style={styles.headerTitleText}>TOOL DETAILS</Text>
                </View>
                <View style={{ width: 74 }} />
            </View>

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator />
                    <Text style={{ marginTop: 10 }}>Loading tool…</Text>
                </View>
            ) : !tool ? (
                <View style={styles.center}>
                    <Text style={styles.h1}>Tool not found</Text>
                    <Text style={styles.p}>No tool exists for ID: {toolId}</Text>
                    <TouchableOpacity style={styles.btn} onPress={() => router.back()}>
                        <Text style={styles.btnText}>Back</Text>
                    </TouchableOpacity>
                </View>
            ) : (
                <>
                    {/* ── Tool info card ── */}
                    <View style={[styles.box, isDamaged && styles.boxDamaged]}>
                        {isDamaged && (
                            <View style={styles.damagedBanner}>
                                <Text style={styles.damagedBannerText}>🔧 Damaged</Text>
                            </View>
                        )}
                        <Text style={styles.h1}>{tool.name || "Unnamed Tool"}</Text>
                        <Text style={styles.p}>ID: {tool.toolId || toolId}</Text>
                        <Text style={styles.p}>Status: {isOverdue ? "Overdue" : isDamaged ? "Damaged" : isCheckedOut ? "Checked Out" : "In Shop"}</Text>
                    </View>

                    {/* ── DAMAGED: show damage details + repair button ── */}
                    {isDamaged && (
                        <View style={styles.box}>
                            <Text style={styles.sectionTitle}>Damage Report</Text>
                            <Text style={styles.label}>Reported by</Text>
                            <Text style={styles.p}>{tool.damagedReportedBy || "—"}</Text>
                            <Text style={styles.label}>Date reported</Text>
                            <Text style={styles.p}>{fmt(tool.damagedReportedAt)}</Text>
                            <Text style={styles.label}>Description</Text>
                            <Text style={styles.p}>{tool.damagedNote || "—"}</Text>

                            <TouchableOpacity
                                style={[styles.btnGreen, saving && styles.btnDisabled]}
                                onPress={markRepaired}
                                disabled={saving}
                            >
                                <Text style={styles.btnText}>{saving ? "Saving..." : "✓ Mark as Repaired"}</Text>
                            </TouchableOpacity>
                        </View>
                    )}

                    {/* ── CHECKED OUT: return + extend ── */}
                    {isCheckedOut && (
                        <View style={[styles.box, isOverdue && styles.boxOverdue]}>
                            {isOverdue && (
                                <View style={styles.overdueBanner}>
                                    <Text style={styles.overdueText}>⚠ This Tool is Overdue</Text>
                                </View>
                            )}

                            <Text style={styles.sectionTitle}>Checked Out</Text>
                            <Text style={styles.p}>Employee: {tool.checkedOutToEmployeeName || "—"}</Text>
                            <Text style={styles.p}>Job: {tool.checkedOutToJobName || "—"}</Text>
                            <Text style={styles.p}>Checked out: {fmt(tool.checkedOutAt)}</Text>
                            <Text style={[styles.p, isOverdue && styles.textOverdue]}>
                                Due back: {fmt(tool.dueBackAt)}
                            </Text>

                            <TouchableOpacity
                                style={[styles.btnOutline, saving && styles.btnDisabled]}
                                onPress={returnTool}
                                disabled={saving}
                            >
                                <Text style={styles.btnOutlineText}>
                                    {saving ? "Saving..." : "Return Tool"}
                                </Text>
                            </TouchableOpacity>

                            {/* Extend Due Date — shown when overdue */}
                            {isOverdue && (
                                <>
                                    <View style={styles.divider} />
                                    <Text style={styles.sectionTitle}>Extend Due Date</Text>
                                    <Text style={styles.label}>New due back date</Text>

                                    <TouchableOpacity style={styles.datePickBtn} onPress={openExtendPicker}>
                                        <Text style={styles.datePickText}>{fmtDateOnly(extendDate)}</Text>
                                    </TouchableOpacity>

                                    {showExtendPicker && (
                                        <View style={styles.pickerWrap}>
                                            <DateTimePicker
                                                value={tempExtendDate}
                                                mode="date"
                                                display={Platform.OS === "ios" ? "spinner" : "default"}
                                                onChange={onExtendPickerChange}
                                                minimumDate={dateOnly(new Date())}
                                                style={{ backgroundColor: "#fff" }}
                                                textColor="#003366"
                                            />
                                            {Platform.OS === "ios" && (
                                                <View style={styles.pickerButtonsRow}>
                                                    <TouchableOpacity style={styles.pillBtn} onPress={cancelIOSExtendDate}>
                                                        <Text style={styles.pillBtnText}>Cancel</Text>
                                                    </TouchableOpacity>
                                                    <TouchableOpacity style={styles.pillBtnPrimary} onPress={confirmIOSExtendDate}>
                                                        <Text style={styles.pillBtnPrimaryText}>Done</Text>
                                                    </TouchableOpacity>
                                                </View>
                                            )}
                                        </View>
                                    )}

                                    <TouchableOpacity
                                        style={[styles.btn, saving && styles.btnDisabled]}
                                        onPress={extendDueDate}
                                        disabled={saving}
                                    >
                                        <Text style={styles.btnText}>{saving ? "Saving..." : "Extend"}</Text>
                                    </TouchableOpacity>
                                </>
                            )}
                        </View>
                    )}

                    {/* ── IN SHOP: check-out form ── */}
                    {!isCheckedOut && !isDamaged && (
                        <View style={styles.box}>
                            <Text style={styles.sectionTitle}>Check Out</Text>

                            <Text style={styles.label}>Employee</Text>
                            <TextInput
                                value={employee}
                                onChangeText={setEmployee}
                                placeholder="e.g. Ashton Hall"
                                style={styles.input}
                            />

                            <Text style={styles.label}>Job</Text>
                            <TextInput
                                value={job}
                                onChangeText={setJob}
                                placeholder="e.g. Unilever Bulk Line"
                                style={styles.input}
                            />

                            <Text style={styles.label}>Due back</Text>
                            <TouchableOpacity style={styles.datePickBtn} onPress={openDatePicker}>
                                <Text style={styles.datePickText}>{fmtDateOnly(dueDate)}</Text>
                            </TouchableOpacity>

                            {showPicker && (
                                <View style={styles.pickerWrap}>
                                    <DateTimePicker
                                        value={tempDueDate}
                                        mode="date"
                                        display={Platform.OS === "ios" ? "spinner" : "default"}
                                        onChange={onPickerChange}
                                        minimumDate={dateOnly(new Date())}
                                        style={{ backgroundColor: "#fff" }}
                                        textColor="#003366"
                                    />
                                    {Platform.OS === "ios" && (
                                        <View style={styles.pickerButtonsRow}>
                                            <TouchableOpacity style={styles.pillBtn} onPress={cancelIOSDate}>
                                                <Text style={styles.pillBtnText}>Cancel</Text>
                                            </TouchableOpacity>
                                            <TouchableOpacity style={styles.pillBtnPrimary} onPress={confirmIOSDate}>
                                                <Text style={styles.pillBtnPrimaryText}>Done</Text>
                                            </TouchableOpacity>
                                        </View>
                                    )}
                                </View>
                            )}

                            <TouchableOpacity
                                style={[styles.btn, saving && styles.btnDisabled]}
                                onPress={checkout}
                                disabled={saving}
                            >
                                <Text style={styles.btnText}>{saving ? "Saving..." : "Check Out"}</Text>
                            </TouchableOpacity>
                        </View>
                    )}

                    {/* ── Report Damage section (shown when tool is not already damaged) ── */}
                    {!isDamaged && (
                        <View style={styles.box}>
                            {!showDamageForm ? (
                                <TouchableOpacity
                                    style={styles.btnDamage}
                                    onPress={() => setShowDamageForm(true)}
                                >
                                    <Text style={styles.btnDamageText}>🔧 Report Damage</Text>
                                </TouchableOpacity>
                            ) : (
                                <>
                                    <Text style={styles.sectionTitle}>Report Damage</Text>

                                    <Text style={styles.label}>Your name</Text>
                                    <TextInput
                                        value={damageReporter}
                                        onChangeText={setDamageReporter}
                                        placeholder="e.g. Ashton Hall"
                                        style={styles.input}
                                    />

                                    <Text style={styles.label}>Describe the damage</Text>
                                    <TextInput
                                        value={damageNote}
                                        onChangeText={setDamageNote}
                                        placeholder="e.g. Cracked housing, won't turn on"
                                        style={[styles.input, styles.inputMultiline]}
                                        multiline
                                        numberOfLines={3}
                                    />

                                    <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                                        <TouchableOpacity
                                            style={[styles.btnDamageSubmit, { flex: 1 }, saving && styles.btnDisabled]}
                                            onPress={reportDamage}
                                            disabled={saving}
                                        >
                                            <Text style={styles.btnText}>{saving ? "Saving..." : "Submit Report"}</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[styles.btnOutline, { flex: 1, marginTop: 0 }]}
                                            onPress={() => { setShowDamageForm(false); setDamageNote(""); setDamageReporter(""); }}
                                        >
                                            <Text style={styles.btnOutlineText}>Cancel</Text>
                                        </TouchableOpacity>
                                    </View>
                                </>
                            )}
                        </View>
                    )}

                    <TouchableOpacity style={styles.smallLink} onPress={load}>
                        <Text style={styles.smallLinkText}>Refresh</Text>
                    </TouchableOpacity>
                </>
            )}
        </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#fff" },
    contentContainer: { paddingTop: 56, paddingHorizontal: 16, paddingBottom: 40 },
    center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 20, paddingVertical: 40 },

    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
    backPill: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: "#003366", backgroundColor: "#f5f8fc", width: 74, alignItems: "center" },
    backText: { color: "#003366", fontWeight: "800", letterSpacing: 1 },
    headerTitlePill: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 14, borderWidth: 1, borderColor: "#d6d6d6", backgroundColor: "#fafafa" },
    headerTitleText: { fontSize: 16, fontWeight: "900", letterSpacing: 1.6, color: "#6B6B6B" },

    box: { marginTop: 12, borderWidth: 1, borderColor: "#e5e5e5", borderRadius: 12, padding: 12 },
    boxOverdue: { borderColor: "#d32f2f", backgroundColor: "#fff8f8" },
    boxDamaged: { borderColor: "#9c27b0", backgroundColor: "#fdf6ff" },

    overdueBanner: { backgroundColor: "#ffeaea", borderRadius: 8, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: "#d32f2f", alignItems: "center" },
    overdueText: { color: "#a80000", fontWeight: "900", fontSize: 15, letterSpacing: 1.2 },
    textOverdue: { color: "#a80000", fontWeight: "700" },

    damagedBanner: { backgroundColor: "#f3e5f5", borderRadius: 8, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: "#9c27b0", alignItems: "center" },
    damagedBannerText: { color: "#6a0080", fontWeight: "900", fontSize: 15, letterSpacing: 1.2 },

    divider: { height: 1, backgroundColor: "#e5e5e5", marginVertical: 16 },

    h1: { fontSize: 22, fontWeight: "700", marginBottom: 8 },
    p: { fontSize: 16, marginBottom: 6 },
    sectionTitle: { fontSize: 18, fontWeight: "800", marginBottom: 8 },
    label: { fontSize: 14, marginTop: 10, marginBottom: 6, color: "#555" },

    input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
    inputMultiline: { minHeight: 72, textAlignVertical: "top" },

    datePickBtn: { borderWidth: 1, borderColor: "#ddd", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: "#fff" },
    datePickText: { fontSize: 16, fontWeight: "700", color: "#003366" },

    pickerWrap: { marginTop: 10, backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#ddd", overflow: "hidden" },
    pickerButtonsRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 10 },

    pillBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: "#003366", backgroundColor: "#f5f8fc" },
    pillBtnText: { color: "#003366", fontWeight: "800", letterSpacing: 1 },
    pillBtnPrimary: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 14, backgroundColor: "#003366" },
    pillBtnPrimaryText: { color: "#fff", fontWeight: "800", letterSpacing: 1 },

    btn: { marginTop: 16, backgroundColor: "#003366", paddingVertical: 12, borderRadius: 10, alignItems: "center" },
    btnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
    btnDisabled: { opacity: 0.6 },

    btnGreen: { marginTop: 16, backgroundColor: "#2e7d32", paddingVertical: 12, borderRadius: 10, alignItems: "center" },

    btnOutline: { marginTop: 16, paddingVertical: 12, borderRadius: 10, alignItems: "center", backgroundColor: "#f5f8fc", borderWidth: 1, borderColor: "#003366" },
    btnOutlineText: { color: "#003366", fontWeight: "800", letterSpacing: 1.2, fontSize: 16 },

    btnDamage: { paddingVertical: 12, borderRadius: 10, alignItems: "center", backgroundColor: "#fff3e0", borderWidth: 1, borderColor: "#e65100" },
    btnDamageText: { color: "#bf360c", fontWeight: "800", fontSize: 15, letterSpacing: 0.5 },
    btnDamageSubmit: { backgroundColor: "#b71c1c", paddingVertical: 12, borderRadius: 10, alignItems: "center" },

    smallLink: { marginTop: 14, alignItems: "center" },
    smallLinkText: { color: "#003366", fontWeight: "600" },
});
