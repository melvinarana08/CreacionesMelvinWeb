document.addEventListener('DOMContentLoaded', async () => {
    // Cargar productos desde JSON
    const productos = await fetch('productos.json').then(res => res.json());
    
    // Inicializar selects
    const initSelects = () => {
        const cantidadSelect = document.getElementById('cantidad');
        for (let i = 1; i <= 100; i++) {
            cantidadSelect.innerHTML += `<option value="${i}">${i}</option>`;
        }

        const productoSelect = document.getElementById('producto');
        Object.keys(productos).forEach(categoria => {
            productoSelect.innerHTML += `<option value="${categoria}">${categoria}</option>`;
        });
    };

    // Cargar carrito desde localStorage
    let carrito = JSON.parse(localStorage.getItem('carrito')) || [];
    
    // Actualizar tallas disponibles
    const actualizarTallas = () => {
        const categoria = document.getElementById('producto').value;
        const tallaSelect = document.getElementById('talla');
        tallaSelect.innerHTML = productos[categoria].map(item => 
            `<option value="${item.talla}">Talla ${item.talla} - $${item.precio.toFixed(2)}</option>`
        ).join('');
    };

    // Event listeners
    document.getElementById('producto').addEventListener('change', actualizarTallas);
    
    document.getElementById('agregar').addEventListener('click', () => {
        const categoria = document.getElementById('producto').value;
        const talla = parseInt(document.getElementById('talla').value);
        const cantidad = parseInt(document.getElementById('cantidad').value);
        
        const producto = productos[categoria].find(item => item.talla === talla);
        const total = producto.precio * cantidad;
        
        carrito.push({
            categoria,
            talla,
            precio: producto.precio,
            cantidad,
            total
        });
        
        guardarCarrito();
        actualizarTabla();
    });

    // Función para actualizar tabla
    const actualizarTabla = () => {
        const tbody = document.querySelector('#productosTabla tbody');
        tbody.innerHTML = '';
        let totalGeneral = 0;

        carrito.forEach((item, index) => {
            totalGeneral += item.total;
            tbody.innerHTML += `
                <tr>
                    <td>${item.categoria}</td>
                    <td>${item.talla}</td>
                    <td>$${item.precio.toFixed(2)}</td>
                    <td>
                        <input type="number" min="1" value="${item.cantidad}" 
                               data-index="${index}" class="editar-cantidad">
                    </td>
                    <td>$${item.total.toFixed(2)}</td>
                    <td>
                        <button class="btn-danger" data-index="${index}">Eliminar</button>
                    </td>
                </tr>
            `;
        });

        document.getElementById('total').textContent = totalGeneral.toFixed(2);
        
        // Eventos dinámicos
        document.querySelectorAll('.editar-cantidad').forEach(input => {
            input.addEventListener('change', (e) => {
                const index = e.target.dataset.index;
                const nuevaCantidad = parseInt(e.target.value);
                carrito[index].cantidad = nuevaCantidad;
                carrito[index].total = carrito[index].precio * nuevaCantidad;
                guardarCarrito();
                actualizarTabla();
            });
        });

        document.querySelectorAll('.btn-danger').forEach(button => {
            button.addEventListener('click', (e) => {
                const index = e.target.dataset.index;
                carrito.splice(index, 1);
                guardarCarrito();
                actualizarTabla();
            });
        });
    };

    // Guardar en localStorage
    const guardarCarrito = () => {
        localStorage.setItem('carrito', JSON.stringify(carrito));
    };

    // Imprimir ticket
    document.getElementById('imprimirTicket').addEventListener('click', () => {
        const ticketBody = document.getElementById('ticketTabla');
        const ticketTotal = document.getElementById('ticketTotal');
        let total = 0;
        
        ticketBody.innerHTML = carrito.map(item => {
            total += item.total;
            return `
                <tr>
                    <td>${item.categoria}</td>
                    <td>${item.talla}</td>
                    <td>$${item.precio.toFixed(2)}</td>
                    <td>${item.cantidad}</td>
                    <td>$${item.total.toFixed(2)}</td>
                </tr>
            `;
        }).join('');

        ticketTotal.textContent = total.toFixed(2);
        
        // Configurar impresión
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <html>
                <head>
                    <title>Ticket de Compra</title>
                    <style>
                        body { font-family: Arial; padding: 20px; }
                        table { width: 100%; border-collapse: collapse; }
                        td, th { border: 1px solid #ddd; padding: 8px; text-align: left; }
                        .total { font-weight: bold; margin-top: 20px; }
                    </style>
                </head>
                <body>
                    ${document.getElementById('ticketImpresion').innerHTML}
                </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.print();
    });

    // Inicialización final
    initSelects();
    actualizarTallas();
    actualizarTabla();
});