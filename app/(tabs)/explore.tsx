import React, { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { useRouter } from "expo-router";
import { collection, getDocs, query } from "firebase/firestore";
import { db } from "../../firebase";

type ToolDoc = {
    toolId?: string;
    name?: string;
    status?: "IN_SHOP" | "CHECKED_OUT" | "DAMAGED" | string;
    checkedOutToEmployeeName?: string;
    checkedOutToJobName?: string;
    dueBackAt?: any;
};

type ToolRow = ToolDoc & { id: string };

function fmtDate(ts: any): string {
    if (!ts?.toDate) return "";
    return ts.toDate().toLocaleDateString("en-US", { month: "long", day: "2-digit" });
}

export default function ToolsScreen() {
    const router = useRouter();
    const [tools, setTools] = useState<ToolRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const loadTools = useCallback(async () => {
        try {
            const snap = await getDocs(query(collection(db, "tools")));
            const rows: ToolRow[] = snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as ToolDoc),
            }));

            // Sort: overdue first, then checked out, then in shop — all by name within group
            const now = new Date();
            rows.sort((a, b) => {
                const aOverdue = a.status === "CHECKED_OUT" && a.dueBackAt?.toDate?.() < now;
                const bOverdue = b.status === "CHECKED_OUT" && b.dueBackAt?.toDate?.() < now;
                if (aOverdue && !bOverdue) return -1;
                if (!aOverdue && bOverdue) return 1;
                if (a.status === "CHECKED_OUT" && b.status !== "CHECKED_OUT") return -1;
                if (a.status !== "CHECKED_OUT" && b.status === "CHECKED_OUT") return 1;
                return (a.name ?? "").localeCompare(b.name ?? "");
            });

            setTools(rows);
        } catch (e: any) {
            Alert.alert("Error", e?.message ?? "Failed to load tools");
        }
    }, []);

    useEffect(() => {
        loadTools().finally(() => setLoading(false));
    }, [loadTools]);

    async function onRefresh() {
        setRefreshing(true);
        await loadTools();
        setRefreshing(false);
    }

    if (loading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#003366" />
                <Text style={{ marginTop: 12, color: "#6B6B6B" }}>Loading tools…</Text>
            </View>
        );
    }

    const now = new Date();

    return (
        <View style={styles.container}>
            <View style={styles.headingPill}>
                <Text style={styles.headingText}>ALL TOOLS</Text>
            </View>

            <FlatList
                data={tools}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.list}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        tintColor="#003366"
                    />
                }
                ListEmptyComponent={
                    <View style={styles.center}>
                        <Text style={styles.emptyText}>No tools found.</Text>
                    </View>
                }
                renderItem={({ item }) => {
                    const isOut = item.status === "CHECKED_OUT";
                    const isDamaged = item.status === "DAMAGED";
                    const isOverdue = isOut && item.dueBackAt?.toDate?.() < now;
                    return (
                        <TouchableOpacity
                            style={[
                                styles.row,
                                isOverdue && styles.rowOverdue,
                                isDamaged && styles.rowDamaged,
                            ]}
                            onPress={() =>
                                router.push(`/tool/${encodeURIComponent(item.id)}`)
                            }
                            activeOpacity={0.7}
                        >
                            <View style={styles.rowLeft}>
                                <Text style={styles.toolName}>
                                    {item.name || "Unnamed Tool"}
                                </Text>
                                <Text style={styles.toolId}>ID: {item.id}</Text>
                                {isOut && (
                                    <>
                                        <Text style={styles.subInfo}>
                                            {item.checkedOutToEmployeeName || "—"}
                                        </Text>
                                        <Text style={[styles.subInfo, isOverdue && styles.subInfoOverdue]}>
                                            Due: {fmtDate(item.dueBackAt)}
                                        </Text>
                                    </>
                                )}
                            </View>
                            <View
                                style={[
                                    styles.badge,
                                    isOverdue ? styles.badgeOverdue
                                        : isDamaged ? styles.badgeDamaged
                                        : isOut ? styles.badgeOut
                                        : styles.badgeIn,
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.badgeText,
                                        isOverdue ? styles.badgeTextOverdue
                                            : isDamaged ? styles.badgeTextDamaged
                                            : isOut ? styles.badgeTextOut
                                            : styles.badgeTextIn,
                                    ]}
                                >
                                    {isOverdue ? "Overdue" : isDamaged ? "Damaged" : isOut ? "Checked Out" : "In Shop"}
                                </Text>
                            </View>
                        </TouchableOpacity>
                    );
                }}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        paddingTop: 60,
        backgroundColor: "#ffffff",
    },
    center: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 20,
    },
    headingPill: {
        alignSelf: "center",
        paddingVertical: 10,
        paddingHorizontal: 22,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "#d6d6d6",
        backgroundColor: "#fafafa",
        marginBottom: 16,
    },
    headingText: {
        fontSize: 22,
        fontWeight: "900",
        letterSpacing: 2,
        color: "#6B6B6B",
    },
    list: {
        paddingHorizontal: 16,
        paddingBottom: 24,
    },
    row: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        padding: 14,
        marginBottom: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "#e5e5e5",
        backgroundColor: "#fff",
    },
    rowOverdue: {
        borderColor: "#d32f2f",
        backgroundColor: "#fff8f8",
    },
    rowDamaged: {
        borderColor: "#9c27b0",
        backgroundColor: "#fdf6ff",
    },
    rowLeft: {
        flex: 1,
        marginRight: 12,
    },
    toolName: {
        fontSize: 17,
        fontWeight: "700",
        color: "#111",
        marginBottom: 2,
    },
    toolId: {
        fontSize: 13,
        color: "#888",
        marginBottom: 2,
    },
    subInfo: {
        fontSize: 13,
        color: "#555",
    },
    subInfoOverdue: {
        color: "#a80000",
        fontWeight: "700",
    },
    badge: {
        paddingVertical: 5,
        paddingHorizontal: 10,
        borderRadius: 8,
        borderWidth: 1,
    },
    badgeIn: {
        backgroundColor: "#edfaf1",
        borderColor: "#34c759",
    },
    badgeOut: {
        backgroundColor: "#fff4e6",
        borderColor: "#ff9500",
    },
    badgeOverdue: {
        backgroundColor: "#ffeaea",
        borderColor: "#d32f2f",
    },
    badgeDamaged: {
        backgroundColor: "#f3e5f5",
        borderColor: "#9c27b0",
    },
    badgeText: {
        fontSize: 12,
        fontWeight: "800",
        letterSpacing: 0.5,
    },
    badgeTextIn: {
        color: "#1a7a3c",
    },
    badgeTextOut: {
        color: "#b05a00",
    },
    badgeTextOverdue: {
        color: "#a80000",
    },
    badgeTextDamaged: {
        color: "#6a0080",
    },
    emptyText: {
        color: "#888",
        fontSize: 16,
    },
});
