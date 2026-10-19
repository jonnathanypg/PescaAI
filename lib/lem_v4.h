/* ==============================================================================
 * LEM-V4 INDUSTRIAL SDK - INTERFAZ PÚBLICA C99
 * ============================================================================== */
#ifndef LEM_V4_H
#define LEM_V4_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define LEM_V4_STATE_DIM   16
#define LEM_V4_SCHEMA_DIM  128
#define LEM_V4_SUCCESS      0
#define LEM_V4_ERR_INVALID -1

typedef struct {
    uint8_t opaque_context[1152] __attribute__((aligned(8)));
} lemv4_context_t;

int lemv4_init(lemv4_context_t* ctx, const double* schema_s128);
int lemv4_evaluate(lemv4_context_t* ctx, const double* state_z16, double* energy_out);
const char* lemv4_get_version(void);

#ifdef __cplusplus
}
#endif

#endif /* LEM_V4_H */
