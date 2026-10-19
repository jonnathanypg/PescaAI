/* ==============================================================================
 * TECOPESCA AI-OS — LEM-OPS & LEM-V4 PERSISTENT C99 SILICON WORKER
 * Evalúa vectores de estado z[16] en microsegundos usando liblemops y liblemv4
 * ============================================================================== */
#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <time.h>
#include "lem_ops.h"
#include "lem_v4.h"

typedef struct {
    char name[64];
    int is_ops;
    lemops_context_t ops_ctx;
    lemv4_context_t v4_ctx;
} schema_slot_t;

#define MAX_SCHEMAS 16
static schema_slot_t g_slots[MAX_SCHEMAS];
static int g_num_slots = 0;

static long now_ns(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (long)ts.tv_sec * 1000000000L + ts.tv_nsec;
}

static void init_pescaai_schemas(void) {
    double S_deslomado[128];
    double S_pre_guard[128];
    double S_post_guard[128];
    double S_tool_guard[128];
    double S_haccp_guard[128];

    /* 1. tecopesca_deslomado_v1 (LEM-Ops + LEM-V4 dual) */
    memset(S_deslomado, 0, sizeof(S_deslomado));
    S_deslomado[0] = 1.0; S_deslomado[1] = -1.0;
    for (int i = 0; i < 16; i++) {
        S_deslomado[16 + i] = 1.0; /* mascara activa */
        S_deslomado[32 + i] = 0.0; /* limite inferior l_i */
        S_deslomado[48 + i] = 1.0; /* limite superior u_i */
    }
    /* Canal 3 (Idempotencia / Duplicado) y Canal 7 (Operaria no asignada / Trampa) y Canal 8 (Límite biológico) */
    S_deslomado[48 + 3] = 0.10; /* Cualquier duplicado z[3] > 0.10 dispara energía */
    S_deslomado[48 + 7] = 0.15; /* Operaria inválida z[7] > 0.15 dispara energía */
    S_deslomado[48 + 8] = 0.15; /* Peso fuera de límite biológico [1.0kg - 24.0kg] dispara energía */
    S_deslomado[63] = 1.5;
    S_deslomado[112] = 100.0; /* GAIN_LIN */
    S_deslomado[113] = 12.0;  /* GAIN_BND */

    strcpy(g_slots[0].name, "tecopesca_deslomado_v1");
    g_slots[0].is_ops = 1;
    lemops_init(&g_slots[0].ops_ctx, S_deslomado);
    lemv4_init(&g_slots[0].v4_ctx, S_deslomado);

    /* 2. lem_v4_pre_guard (Anti-Prompt Injection, SQLi, Path Traversal, Audio Entropy) */
    memset(S_pre_guard, 0, sizeof(S_pre_guard));
    S_pre_guard[0] = 1.0; S_pre_guard[1] = -1.0;
    for (int i = 0; i < 16; i++) {
        S_pre_guard[16 + i] = 1.0;
        S_pre_guard[32 + i] = 0.0;
        S_pre_guard[48 + i] = 1.0;
    }
    /* Canal 2: Inyección / Ataque detectado -> trampa estricta */
    S_pre_guard[16 + 2] = 0.0; S_pre_guard[48 + 2] = 0.0;
    /* Canal 7: Trampa de canal durmiente */
    S_pre_guard[16 + 7] = 0.0; S_pre_guard[48 + 7] = 0.0;
    S_pre_guard[112] = 50.0;
    S_pre_guard[113] = 15.0;

    strcpy(g_slots[1].name, "lem_v4_pre_guard");
    g_slots[1].is_ops = 0;
    lemops_init(&g_slots[1].ops_ctx, S_pre_guard);
    lemv4_init(&g_slots[1].v4_ctx, S_pre_guard);

    /* 3. lem_v4_post_guard (Anti-Alucinación Numérica, Fuga PII, XSS/SQL en salida) */
    memset(S_post_guard, 0, sizeof(S_post_guard));
    S_post_guard[0] = 1.0; S_post_guard[1] = -1.0;
    for (int i = 0; i < 16; i++) {
        S_post_guard[16 + i] = 1.0;
        S_post_guard[32 + i] = 0.0;
        S_post_guard[48 + i] = 1.0;
    }
    /* Canal 1: Alucinación numérica sin respaldo SQL -> dispara energía */
    S_post_guard[16 + 1] = 0.0; S_post_guard[48 + 1] = 0.0;
    /* Canal 2: Vulnerabilidad en salida -> dispara energía */
    S_post_guard[16 + 2] = 0.0; S_post_guard[48 + 2] = 0.0;
    S_post_guard[112] = 60.0;
    S_post_guard[113] = 15.0;

    strcpy(g_slots[2].name, "lem_v4_post_guard");
    g_slots[2].is_ops = 0;
    lemops_init(&g_slots[2].ops_ctx, S_post_guard);
    lemv4_init(&g_slots[2].v4_ctx, S_post_guard);

    /* 4. gov_action_guard_v1 (LEM-Ops Tool Guard & RBAC) */
    memset(S_tool_guard, 0, sizeof(S_tool_guard));
    S_tool_guard[0] = 1.0; S_tool_guard[1] = -1.0;
    for (int i = 0; i < 16; i++) {
        S_tool_guard[16 + i] = 1.0;
        S_tool_guard[32 + i] = 0.0;
        S_tool_guard[48 + i] = 1.0;
    }
    S_tool_guard[63] = 1.5;
    S_tool_guard[112] = 100.0;
    S_tool_guard[113] = 10.0;

    strcpy(g_slots[3].name, "gov_action_guard_v1");
    g_slots[3].is_ops = 1;
    lemops_init(&g_slots[3].ops_ctx, S_tool_guard);
    lemv4_init(&g_slots[3].v4_ctx, S_tool_guard);

    /* 5. tecopesca_haccp_thermal_v1 (Control Térmico Autoclaves / Cadena de Frío / Calidad) */
    memset(S_haccp_guard, 0, sizeof(S_haccp_guard));
    S_haccp_guard[0] = 1.0; S_haccp_guard[1] = -1.0;
    for (int i = 0; i < 16; i++) {
        S_haccp_guard[16 + i] = 1.0;
        S_haccp_guard[32 + i] = 0.0;
        S_haccp_guard[48 + i] = 1.0;
    }
    S_haccp_guard[48 + 7] = 0.15; /* Desviación térmica o histamine risk */
    S_haccp_guard[112] = 80.0;
    S_haccp_guard[113] = 12.0;

    strcpy(g_slots[4].name, "tecopesca_haccp_thermal_v1");
    g_slots[4].is_ops = 0;
    lemops_init(&g_slots[4].ops_ctx, S_haccp_guard);
    lemv4_init(&g_slots[4].v4_ctx, S_haccp_guard);

    g_num_slots = 5;
}

static schema_slot_t* find_slot(const char* name) {
    for (int i = 0; i < g_num_slots; i++) {
        if (strcmp(g_slots[i].name, name) == 0) {
            return &g_slots[i];
        }
    }
    return &g_slots[0];
}

int main(void) {
    init_pescaai_schemas();
    const char* ver_ops = lemops_get_version();
    const char* ver_v4 = lemv4_get_version();

    /* Desactivar buffering de salida para IPC instantáneo */
    setvbuf(stdout, NULL, _IOLBF, 0);

    char line[4096];
    while (fgets(line, sizeof(line), stdin)) {
        /* Formato de entrada:
         * STATUS
         * o
         * EVAL <req_id> <engine:ops|v4|dual> <schema_name> <z0> <z1> ... <z15>
         */
        if (strncmp(line, "STATUS", 6) == 0) {
            printf("{\"type\":\"STATUS\",\"ops_version\":\"%s\",\"v4_version\":\"%s\",\"schemas\":%d}\n",
                   ver_ops ? ver_ops : "unknown", ver_v4 ? ver_v4 : "unknown", g_num_slots);
            continue;
        }

        if (strncmp(line, "EVAL ", 5) == 0) {
            char req_id[64] = {0};
            char engine[16] = {0};
            char schema_name[64] = {0};
            double z[16] = {0};

            char *p = line + 5;
            char *tok = strtok(p, " \t\r\n");
            if (!tok) continue;
            strncpy(req_id, tok, sizeof(req_id) - 1);

            tok = strtok(NULL, " \t\r\n");
            if (!tok) continue;
            strncpy(engine, tok, sizeof(engine) - 1);

            tok = strtok(NULL, " \t\r\n");
            if (!tok) continue;
            strncpy(schema_name, tok, sizeof(schema_name) - 1);

            int bad_input = 0;
            for (int i = 0; i < 16; i++) {
                tok = strtok(NULL, " \t\r\n");
                if (!tok) {
                    z[i] = 0.0;
                } else {
                    char *end = NULL;
                    double val = strtod(tok, &end);
                    if (!isfinite(val) || fabs(val) > 1e12) {
                        bad_input = 1;
                        z[i] = 1.0e9;
                    } else {
                        z[i] = val;
                    }
                }
            }

            long t0 = now_ns();
            schema_slot_t *slot = find_slot(schema_name);
            double e_ops = 1.0e9, e_v4 = 1.0e9, e_final = 1.0e9;
            int rc_ops = -1, rc_v4 = -1;

            if (!bad_input) {
                rc_ops = lemops_evaluate(&slot->ops_ctx, z, &e_ops);
                rc_v4 = lemv4_evaluate(&slot->v4_ctx, z, &e_v4);
                if (rc_ops != 0 || !isfinite(e_ops)) e_ops = 1.0e9;
                if (rc_v4 != 0 || !isfinite(e_v4)) e_v4 = 1.0e9;

                if (strcmp(engine, "ops") == 0) {
                    e_final = e_ops;
                } else if (strcmp(engine, "v4") == 0) {
                    e_final = e_v4;
                } else {
                    /* dual: toma el máximo conservador (fail-closed estricto) */
                    e_final = (e_ops > e_v4) ? e_ops : e_v4;
                }
            }

            long t1 = now_ns();
            double latency_us = (double)(t1 - t0) / 1000.0;
            int accepted = (!bad_input && isfinite(e_final) && e_final < 0.20) ? 1 : 0;

            printf("{\"type\":\"RESULT\",\"id\":\"%s\",\"accepted\":%s,\"energy\":%.6f,\"energy_ops\":%.6f,\"energy_v4\":%.6f,\"threshold\":0.20,\"latency_us\":%.2f,\"schema\":\"%s\",\"engine\":\"%s\",\"ops_ver\":\"%s\",\"v4_ver\":\"%s\"}\n",
                   req_id,
                   accepted ? "true" : "false",
                   e_final > 999999.0 ? 999999.0 : e_final,
                   e_ops > 999999.0 ? 999999.0 : e_ops,
                   e_v4 > 999999.0 ? 999999.0 : e_v4,
                   latency_us,
                   slot->name,
                   engine,
                   ver_ops ? ver_ops : "LEM-OPS",
                   ver_v4 ? ver_v4 : "LEM-V4");
        }
    }
    return 0;
}
