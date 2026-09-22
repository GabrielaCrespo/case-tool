# Reglas de R8 para la compilación de release.
#
# Todas son `-dontwarn`, y ninguna esconde un problema de esta aplicación: son
# clases que las librerías nombran pero que no existen en el aparato, y que
# ellas mismas comprueban antes de usar. Sin estas líneas, R8 se niega a
# terminar y no hay APK de release.

# ---------------------------------------------------------------- flutter_gemma
# El modelo de lenguaje que corre en el teléfono (CU09) va sobre MediaPipe, que
# está generado con protobuf. Lo que falta son las anotaciones de protobuf, que
# sólo existen al compilar la librería, y dos mensajes de perfilado que la
# variante que se empaqueta no incluye.
-dontwarn com.google.mediapipe.proto.CalculatorProfileProto$CalculatorProfile
-dontwarn com.google.mediapipe.proto.GraphTemplateProto$CalculatorGraphTemplate
-dontwarn com.google.protobuf.Internal$ProtoMethodMayReturnNull
-dontwarn com.google.protobuf.Internal$ProtoNonnullApi
-dontwarn com.google.protobuf.ProtoField
-dontwarn com.google.protobuf.ProtoPresenceBits
-dontwarn com.google.protobuf.ProtoPresenceCheckedField

# Y lo que MediaPipe carga por reflexión sí hay que conservarlo: si R8 le
# cambia el nombre, el modelo no arranca.
-keep class com.google.mediapipe.** { *; }
-keep class com.google.protobuf.** { *; }

# --------------------------------------------------------------------- OkHttp
# OkHttp sabe usar tres proveedores de TLS alternativos si alguien los añade al
# proyecto. No los añadimos: se usa el de Android. OkHttp ya comprueba que
# estén antes de tocarlos, así que su ausencia no es un fallo.
-dontwarn org.bouncycastle.jsse.BCSSLParameters
-dontwarn org.bouncycastle.jsse.BCSSLSocket
-dontwarn org.bouncycastle.jsse.provider.BouncyCastleJsseProvider
-dontwarn org.conscrypt.Conscrypt$Version
-dontwarn org.conscrypt.Conscrypt
-dontwarn org.conscrypt.ConscryptHostnameVerifier
-dontwarn org.openjsse.javax.net.ssl.SSLParameters
-dontwarn org.openjsse.javax.net.ssl.SSLSocket
-dontwarn org.openjsse.net.ssl.OpenJSSE

# ----------------------------------------------------------------- Flutter
# El puente entre Dart y Java, que se resuelve por nombre.
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }

# Flutter trae de serie el código para descargar partes de la aplicación desde
# Google Play a medida que hacen falta. Esta aplicación no usa nada de eso —se
# instala entera y de una vez—, así que la librería de Play no se empaqueta y
# estas clases no existen. El código que las nombra nunca llega a ejecutarse.
-dontwarn com.google.android.play.core.**
